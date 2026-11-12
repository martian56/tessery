use redis::aio::ConnectionManager;

pub async fn allow(
    redis: &mut ConnectionManager,
    key: &str,
    limit: u32,
    window_secs: u64,
) -> redis::RedisResult<bool> {
    let k = format!("tessery:rl:{key}");
    let (count,): (u32,) = redis::pipe()
        .atomic()
        .incr(&k, 1)
        .ignore()
        .expire(&k, window_secs as i64)
        .ignore()
        .get(&k)
        .query_async(redis)
        .await?;
    Ok(count <= limit)
}

pub async fn reset(redis: &mut ConnectionManager, key: &str) -> redis::RedisResult<()> {
    let _: () = redis::cmd("DEL")
        .arg(format!("tessery:rl:{key}"))
        .query_async(redis)
        .await?;
    Ok(())
}
