extends RefCounted
## Report texture assignments on visible 2D nodes in an exercised scene.
## A caller can unwrap project-specific runtime textures before recording their paths.

static func visit(node: Node, observe: Callable) -> void:
	if node is CanvasItem and not node.is_visible_in_tree():
		return
	if node is Sprite2D or node is TextureRect or node is Polygon2D or node is GPUParticles2D or node is CPUParticles2D or node is MeshInstance2D:
		if node.texture != null:
			observe.call(node.texture)
	elif node is AnimatedSprite2D and node.sprite_frames != null:
		var texture: Texture2D = node.sprite_frames.get_frame_texture(node.animation, node.frame)
		if texture != null:
			observe.call(texture)
	for child in node.get_children():
		visit(child, observe)


static func source_path(texture: Texture2D) -> String:
	while texture is AtlasTexture:
		texture = (texture as AtlasTexture).atlas
	if texture == null:
		return ""
	return texture.resource_path.trim_prefix("res://") if texture.resource_path.begins_with("res://") else ""
