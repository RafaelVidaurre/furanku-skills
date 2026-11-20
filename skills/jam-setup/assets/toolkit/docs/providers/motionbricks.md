# NVIDIA MotionBricks

Serves the motion route in the `inbetween` mode: motion between poses the project supplies, on NVIDIA's SOMA skeleton. The neutral procedure is [providers.md](../providers.md).

- **Reach:** the `jam-3d-motionbricks` skill, the only transport. It owns everything true of MotionBricks itself: what the generating host needs and how to check one, how long one generation is and how generations chain, packing and unpacking, and the licence rules for the models and NVIDIA's sample motions. Read it before the first generation; its validation reference lists what was run.
- **Unit and quote:** nothing per job (`paid: false`). The compute is the person's, on their own machine or a GPU they rent, billed by its host outside the run's ledger.
- **Skeleton:** the descriptor's `rig.landmarks` is the skill's SOMA landmark map (`assets/landmark-maps/soma.json` in `jam-3d-motionbricks`); a repository test keeps the two equal. Poses go in and clips come out on SOMA, so `jam-3d-retarget` carries them between the project rig and SOMA both ways.
- **Pacing:** one generation at a time. The first run of a precision on a host builds its runtime plan, which takes minutes; later requests take seconds.
- **Recovery:** nothing is charged, so a lost result is generated again from the same request.
