use futures_util::StreamExt;
use lapin::options::{
    BasicAckOptions, BasicConsumeOptions, BasicNackOptions, BasicPublishOptions, BasicQosOptions,
    ConfirmSelectOptions, QueueDeclareOptions,
};
use lapin::types::{AMQPValue, FieldTable, ShortString};
use lapin::{BasicProperties, Channel, Connection, ConnectionProperties};
use serde::{Deserialize, Serialize};
use std::future::Future;
use uuid::Uuid;

pub const JOBS_QUEUE: &str = "tessery.jobs";
pub const DEAD_LETTER_QUEUE: &str = "tessery.jobs.dead";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Job {
    AuditExport { export_id: Uuid },
    SweepExpiredGrants,
    PushRemote { project_id: Uuid },
    Deploy { release_id: Uuid },
    Teardown {
        project_id: Uuid,
        env: String,
        plan: serde_json::Value,
        kubeconfig: Option<Vec<u8>>,
        #[serde(default)]
        connection: Vec<(String, Vec<u8>)>,
        destroy: bool,
    },
}

impl Job {
    pub fn summary(&self) -> String {
        match self {
            Job::AuditExport { export_id } => format!("audit export {export_id}"),
            Job::SweepExpiredGrants => "sweep expired grants".into(),
            Job::PushRemote { project_id } => format!("push remote for {project_id}"),
            Job::Deploy { release_id } => format!("deploy release {release_id}"),
            Job::Teardown { project_id, env, destroy, .. } => format!("{} {env} of {project_id}", if *destroy { "destroy" } else { "stop" }),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Envelope {
    pub id: Uuid,
    pub job: Job,
}

#[derive(Debug, thiserror::Error)]
pub enum MqError {
    #[error(transparent)]
    Amqp(#[from] lapin::Error),
    #[error("invalid message: {0}")]
    Decode(#[from] serde_json::Error),
    #[error("broker did not confirm the message")]
    NotConfirmed,
}

#[derive(Clone)]
pub struct Mq {
    url: std::sync::Arc<str>,
    name: std::sync::Arc<str>,
    link: std::sync::Arc<tokio::sync::Mutex<Link>>,
}

struct Link {
    channel: Channel,
    _conn: Connection,
}

impl Mq {
    pub async fn connect(url: &str, name: &str) -> Result<Self, MqError> {
        let link = open(url, name).await?;
        Ok(Self { url: url.into(), name: name.into(), link: std::sync::Arc::new(tokio::sync::Mutex::new(link)) })
    }

    async fn channel(&self) -> Result<Channel, MqError> {
        let mut link = self.link.lock().await;
        if !link.channel.status().connected() {
            tracing::warn!(name = %self.name, "RabbitMQ connection lost, reconnecting");
            *link = open(&self.url, &self.name).await?;
            tracing::info!(name = %self.name, "reconnected to RabbitMQ");
        }
        Ok(link.channel.clone())
    }

    pub async fn publish(&self, job: Job) -> Result<Uuid, MqError> {
        let env = Envelope {
            id: Uuid::now_v7(),
            job,
        };
        let body = serde_json::to_vec(&env)?;
        let props = BasicProperties::default()
            .with_delivery_mode(2)
            .with_content_type(ShortString::from("application/json"))
            .with_message_id(ShortString::from(env.id.to_string()));
        let mut attempt = 0;
        let confirm = loop {
            let channel = self.channel().await?;
            let sent = async { channel.basic_publish("".into(), JOBS_QUEUE.into(), BasicPublishOptions::default(), &body, props.clone()).await?.await }.await;
            match sent {
                Ok(c) => break c,
                Err(e) if attempt == 0 => {
                    tracing::warn!(error = %e, "publishing failed, retrying on a new connection");
                    attempt += 1;
                    let mut link = self.link.lock().await;
                    *link = open(&self.url, &self.name).await?;
                }
                Err(e) => return Err(e.into()),
            }
        };
        if confirm.is_nack() {
            return Err(MqError::NotConfirmed);
        }
        Ok(env.id)
    }

    pub async fn consume<F, Fut, E>(&self, tag: &str, prefetch: u16, handler: F) -> Result<(), MqError>
    where
        F: Fn(Envelope) -> Fut,
        Fut: Future<Output = Result<(), E>> + Send + 'static,
        E: std::fmt::Display,
    {
        let mut backoff = std::time::Duration::from_secs(1);
        loop {
            let started = std::time::Instant::now();
            let result = match self.channel().await {
                Ok(channel) => self.consume_on(&channel, tag, prefetch, &handler).await,
                Err(e) => Err(e),
            };
            match result {
                Ok(()) => tracing::warn!("RabbitMQ closed the consumer, reconnecting"),
                Err(e) => tracing::error!(error = %e, "RabbitMQ consumer failed, reconnecting"),
            }
            if started.elapsed() > std::time::Duration::from_secs(60) {
                backoff = std::time::Duration::from_secs(1);
            }
            tokio::time::sleep(backoff).await;
            backoff = (backoff * 2).min(std::time::Duration::from_secs(30));
        }
    }

    async fn consume_on<F, Fut, E>(&self, channel: &Channel, tag: &str, prefetch: u16, handler: &F) -> Result<(), MqError>
    where
        F: Fn(Envelope) -> Fut,
        Fut: Future<Output = Result<(), E>> + Send + 'static,
        E: std::fmt::Display,
    {
        channel
            .basic_qos(prefetch, BasicQosOptions::default())
            .await?;
        let mut consumer = channel
            .basic_consume(
                JOBS_QUEUE.into(),
                tag.into(),
                BasicConsumeOptions::default(),
                FieldTable::default(),
            )
            .await?;
        let slots = std::sync::Arc::new(tokio::sync::Semaphore::new(prefetch.max(1) as usize));
        while let Some(delivery) = consumer.next().await {
            let delivery = delivery?;
            let env: Envelope = match serde_json::from_slice(&delivery.data) {
                Ok(env) => env,
                Err(e) => {
                    tracing::error!(error = %e, "dropping undecodable message to dead-letter queue");
                    delivery
                        .nack(BasicNackOptions {
                            requeue: false,
                            ..Default::default()
                        })
                        .await?;
                    continue;
                }
            };
            let permit = slots.clone().acquire_owned().await.expect("semaphore is never closed");
            let id = env.id;
            let job = handler(env);
            tokio::spawn(async move {
                let _permit = permit;
                let result = job.await.map_err(|e| e.to_string());
                let outcome = match result {
                    Ok(()) => delivery.ack(BasicAckOptions::default()).await,
                    Err(e) => {
                        tracing::error!(job_id = %id, error = %e, "job failed");
                        delivery
                            .nack(BasicNackOptions {
                                requeue: false,
                                ..Default::default()
                            })
                            .await
                    }
                };
                if let Err(e) = outcome {
                    tracing::error!(job_id = %id, error = %e, "could not settle the job with RabbitMQ");
                }
            });
        }
        Ok(())
    }

    pub async fn healthy(&self) -> bool {
        tokio::time::timeout(std::time::Duration::from_secs(5), self.channel()).await.is_ok_and(|c| c.is_ok())
    }
}

async fn open(url: &str, name: &str) -> Result<Link, MqError> {
    let conn = Connection::connect(url, ConnectionProperties::default().with_connection_name(name.into())).await?;
    let channel = conn.create_channel().await?;
    channel.confirm_select(ConfirmSelectOptions::default()).await?;
    declare_topology(&channel).await?;
    Ok(Link { channel, _conn: conn })
}

async fn declare_topology(channel: &Channel) -> Result<(), MqError> {
    channel
        .queue_declare(
            DEAD_LETTER_QUEUE.into(),
            QueueDeclareOptions::durable(),
            FieldTable::default(),
        )
        .await?;
    let mut args = FieldTable::default();
    args.insert(
        "x-dead-letter-exchange".into(),
        AMQPValue::LongString("".into()),
    );
    args.insert(
        "x-dead-letter-routing-key".into(),
        AMQPValue::LongString(DEAD_LETTER_QUEUE.into()),
    );
    args.insert(
        "x-queue-type".into(),
        AMQPValue::LongString("quorum".into()),
    );
    channel
        .queue_declare(JOBS_QUEUE.into(), QueueDeclareOptions::durable(), args)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn job_wire_format_is_stable() {
        let id = Uuid::nil();
        let json = serde_json::to_value(Envelope {
            id,
            job: Job::AuditExport { export_id: id },
        })
        .unwrap();
        assert_eq!(json["job"]["type"], "audit_export");
        assert_eq!(
            serde_json::to_value(Job::SweepExpiredGrants).unwrap()["type"],
            "sweep_expired_grants"
        );
    }
}
