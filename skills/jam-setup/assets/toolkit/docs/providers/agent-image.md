# The agent's own image tool

Serves the image route with a generation or editing tool the running agent already has. Unit: the agent session's own usage, so no job is billed and no spending cap applies. The neutral procedure is [providers.md](../providers.md); image rules are in [images.md](../images.md).

## Check it is callable

Look at the tools this session can actually call. A model or harness name, or an installed image skill, does not prove an image tool is present. The route is callable when you can name the tool and it accepts the inputs the work needs (reference images for an edit or a turnaround).

Say what the usage counts against (the person's plan, a metered session) when you know, and that you do not know when you do not.

## Use

- Attach reference images through the tool's own inputs. A file name in the prompt attaches nothing.
- For independent alternatives, use a separate session per image where the host allows it; say so when it does not.
- Copy each output from the harness's private storage into the run folder before depending on it, and keep the original bytes.
- Record with `--tool "<tool name and version>"`. There is no job to open.

When this tool is missing, the image route still has other providers (`jam provider list`), image search and images the person supplies.
