use super::WorldError;
use crate::tick::Tick;
use crate::{Tick as T2, world::World};
use std::collections::HashMap;

pub struct Grid {
    cells: HashMap<u32, Tick>,
}

impl Grid {
    pub fn check(&self) -> Result<(), WorldError> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::World as W;

    #[test]
    fn builds() {
        let _ = (W::default, T2, World);
    }
}
