use serde::Serialize;
use std::time::Duration;

#[derive(Serialize)]
pub struct Tick(pub Duration);
