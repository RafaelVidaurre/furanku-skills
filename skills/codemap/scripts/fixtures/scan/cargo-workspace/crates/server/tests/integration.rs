mod common;

use common::setup;
use serde_json::json;
use sim_core::Tick;

#[test]
fn runs() {
    let _ = (setup(), json!({}), Tick);
}
