use rand::Rng;
use redis::AsyncCommands;
use redis::aio::ConnectionManager;
use sha2::{Digest, Sha256};
use std::time::Duration;
use uuid::Uuid;

pub const COOKIE: &str = "tessery_session";

fn key(token: &str) -> String {
    format!(
        "tessery:session:{}",
        hex::encode(Sha256::digest(token.as_bytes()))
    )
}

fn user_index(user_id: Uuid) -> String {
    format!("tessery:user-sessions:{user_id}")
}

pub async fn create(
    redis: &mut ConnectionManager,
    user_id: Uuid,
    ttl: Duration,
) -> redis::RedisResult<String> {
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    let token = hex::encode(bytes);
    let k = key(&token);
    redis::pipe()
        .atomic()
        .set_ex(&k, user_id.to_string(), ttl.as_secs())
        .sadd(user_index(user_id), &k)
        .expire(user_index(user_id), ttl.as_secs() as i64)
        .query_async::<()>(redis)
        .await?;
    Ok(token)
}

pub async fn resolve(
    redis: &mut ConnectionManager,
    token: &str,
    ttl: Duration,
) -> redis::RedisResult<Option<Uuid>> {
    let value: Option<String> = redis
        .get_ex(key(token), redis::Expiry::EX(ttl.as_secs()))
        .await?;
    Ok(value.and_then(|v| v.parse().ok()))
}

pub async fn destroy(redis: &mut ConnectionManager, token: &str) -> redis::RedisResult<()> {
    let _: () = redis.del(key(token)).await?;
    Ok(())
}

pub async fn destroy_all(
    redis: &mut ConnectionManager,
    user_id: Uuid,
    keep_token: Option<&str>,
) -> redis::RedisResult<()> {
    let keep = keep_token.map(key);
    let keys: Vec<String> = redis.smembers(user_index(user_id)).await?;
    let doomed: Vec<&String> = keys.iter().filter(|k| Some(*k) != keep.as_ref()).collect();
    if !doomed.is_empty() {
        let _: () = redis.del(&doomed).await?;
        let _: () = redis.srem(user_index(user_id), &doomed).await?;
    }
    Ok(())
}
