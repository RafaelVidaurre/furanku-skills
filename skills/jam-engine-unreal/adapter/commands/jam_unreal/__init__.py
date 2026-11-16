"""Engine-free helpers of the Unreal adapter: configuration, path mapping, receipts, transport, locks, hull geometry.

Nothing in this package imports `unreal` or `bpy`, so it runs under plain Python and is unit-tested without an engine.
Modules named in an editor script's `# jam: include` line are pasted into that script before it is sent to the editor.
"""
