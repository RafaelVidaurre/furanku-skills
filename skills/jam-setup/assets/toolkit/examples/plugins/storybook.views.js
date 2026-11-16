// Browser half of the storybook plugin's type views and panels. The plugin declares this file under
// `views` (it ships beside the plugin, so the declaration is a file: URL); a scene names its
// exports as a view and a panel. Each export is `mount(host, ctx)`, with no framework.

// The scene's cast as a strip of cards; one can be highlighted. The highlight is the view's state:
// it is kept in the page address and is what `viewer.control { view: { highlight } }` changes.
export function beats(host, ctx) {
  const stage = document.createElement('div');
  stage.className = 'storybook-beats';
  stage.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;padding:16px;min-height:160px;align-content:flex-start';
  ctx.markStage(stage);
  host.append(stage);
  let cast = null;
  let highlight = typeof ctx.state.highlight === 'string' ? ctx.state.highlight : null;
  const draw = () => {
    stage.replaceChildren(...(cast ?? []).map((character) => {
      const card = document.createElement('span');
      card.textContent = character.name;
      card.dataset.character = character.id;
      card.style.cssText = `padding:10px 14px;border-radius:8px;border:1px solid ${character.id === highlight ? '#7aa2ff' : '#333'}`;
      return card;
    }));
  };
  const ids = Array.isArray(ctx.unit.attrs.characters) ? ctx.unit.attrs.characters : [];
  Promise.all(ids.map((id) => ctx.call('unit.get', { id }).then((d) => ({ id, name: d.unit.name }), () => ({ id, name: id })))).then((found) => { cast = found; draw(); });
  return {
    state: () => ({ status: cast === null ? 'loading' : 'ready', renderer: 'storybook beats view', cast: (cast ?? []).map((c) => c.id), highlight }),
    control: (command) => {
      if (!('highlight' in command)) return false;
      if (command.highlight !== null && !ids.includes(command.highlight)) throw new Error(`${command.highlight} is not in this scene`);
      highlight = command.highlight;
      ctx.setState(highlight === null ? {} : { highlight });
      draw();
      return { highlight };
    },
    dispose: () => host.replaceChildren(),
  };
}

// A sidebar section: where the scene sits in the running order, from the plugin's own action.
export function placement(host, ctx) {
  const line = document.createElement('p');
  line.className = 'storybook-placement';
  line.textContent = 'Reading the running order…';
  host.append(line);
  ctx.call('storybook.outline', {}).then(({ scenes }) => {
    const index = scenes.findIndex((scene) => `scene/${scene.id}` === ctx.unit.id);
    line.textContent = index < 0 ? 'Not in the running order' : `Scene ${index + 1} of ${scenes.length}`;
  }, (e) => { line.textContent = e.message; });
  return { dispose: () => host.replaceChildren() };
}
