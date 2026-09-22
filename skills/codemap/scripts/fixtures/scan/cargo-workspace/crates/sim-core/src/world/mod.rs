mod grid;

pub use grid::Grid;

pub struct World {
    pub grid: Grid,
}

pub enum WorldError {
    OutOfBounds,
}
