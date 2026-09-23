package arena

type Position struct{ X, Y int }
type World map[int]Position

func Tick(world World, input map[int]Position) {
    for entity, delta := range input {
        p := world[entity]
        world[entity] = Position{p.X + delta.X, p.Y + delta.Y}
    }
}
