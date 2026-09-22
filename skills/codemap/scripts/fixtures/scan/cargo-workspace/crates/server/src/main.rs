use sim_core::{Tick, World};
use tokio::runtime::Runtime;

mod handlers;

fn main() {
    let _ = (Tick, World, Runtime::new, handlers::handle);
}
