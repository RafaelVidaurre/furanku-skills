"""Make or update one MetaSound Source that plays a random one of several SoundWaves. Runs inside a live Unreal editor.

ARGS: {"asset": "/Game/Audio/.../MSS_Name", "variants": ["<SoundWave object path>", ...],
       "patch": "<id of the project's shared random-variant MetaSound Patch>",
       "toolsets": {"authoring": "...", "inspection": "...", "discovery": "..."},   the editor's MetaSound toolset names
       "author": "<author text stored on a new asset>"}
The Source holds one node of the shared patch, with the waves as its `Variants` input, so every sound's variation
(shuffle, pitch, gain) is authored once in the patch. Graph writes go through the editor's MetaSound authoring
toolset, reached with `call_tool`, which the editor's Python tool provides together with top-level await: this
script cannot run in a commandlet. On an existing Source the patch node is replaced, so inputs added to the patch
since appear on reimport.
"""
import asyncio
import json
import uuid

import unreal


async def main(ARGS):
    PATCH = ARGS['patch']
    AUTHORING, INSPECTION, DISCOVERY = (ARGS['toolsets'][k] for k in ('authoring', 'inspection', 'discovery'))
    patch_name = PATCH.rsplit('/', 1)[-1]

    async def author(tool, **args):
        result = await call_tool(AUTHORING + '.' + tool, **args)  # noqa: F821 (provided by the editor's Python tool)
        if isinstance(result, dict) and 'bOk' in result and not result['bOk']:
            raise RuntimeError(builder + ' ' + tool + ': ' + json.dumps(result))
        await asyncio.sleep(0)
        return result

    asset = ARGS['asset']
    if not unreal.EditorAssetLibrary.does_asset_exist(PATCH):
        raise RuntimeError('Missing shared random-variant patch: ' + PATCH)
    # Load the patch before registry discovery, including after a cold editor start.
    unreal.load_asset(PATCH)
    for wave in ARGS['variants']:
        if not isinstance(unreal.load_asset(wave), unreal.SoundWave):
            raise RuntimeError('Variant is not a SoundWave: ' + wave)
    found = await call_tool(DISCOVERY + '.FindNodeClasses', pattern=patch_name, inputs=[], outputs=[], bIncludeNonAddable=False, maxResults=20, firstResult=0, maxPerGroup=0)  # noqa: F821
    matches = [g for g in found['results'] if g['displayName'] == patch_name]
    if len(matches) != 1 or len(matches[0]['variants']) != 1:
        raise RuntimeError('Shared patch class is ambiguous: ' + json.dumps(found))
    group = matches[0]
    cls = {'namespace': group['namespace'], 'name': group['name'], 'variant': group['variants'][0]}
    pins = await call_tool(DISCOVERY + '.DescribeNodeClass', **cls)  # noqa: F821
    builder = 'SfxVariants_' + uuid.uuid4().hex
    existing = unreal.EditorAssetLibrary.does_asset_exist(asset)
    if existing:
        doc = await author('AttachBuilderToAsset', assetPath=asset, builderName=builder, page='Default')
        nodes = await call_tool(INSPECTION + '.FindAllNodes', builderName=builder, page='Default')  # noqa: F821
        patches = [n for n in nodes if n.get('assetPath', '').split('.')[0] == PATCH]
        if len(patches) != 1:
            raise RuntimeError('Expected one shared variant patch in ' + asset + ': ' + json.dumps(nodes))
        # Replace this generated node through the toolset so newly added patch inputs appear on reimport.
        await author('RemoveNodes', builderName=builder, nodes=[patches[0]['ref']], bRemoveUnusedDependencies=True, page='Default')
    else:
        doc = await author('CreateSourceBuilder', builderName=builder, outputFormat='Stereo', bIsOneShot=True)
    interfaces = await call_tool(INSPECTION + '.FindBuilderInterfaces', builderName=builder)  # noqa: F821
    for interface in interfaces:
        await call_tool(INSPECTION + '.FindInterfaceInputNodes', builderName=builder, interfaceName=interface['name'])  # noqa: F821
        await call_tool(INSPECTION + '.FindInterfaceOutputNodes', builderName=builder, interfaceName=interface['name'])  # noqa: F821
    play = [p['name'] for p in doc['inputs'] if p['dataType'] == 'Trigger']
    finished = [p['name'] for p in doc['outputs'] if p['dataType'] == 'Trigger']
    audio = sorted(p['name'] for p in doc['outputs'] if p['dataType'] == 'Audio')
    if len(play) != 1 or len(finished) != 1 or len(audio) != 2:
        raise RuntimeError('Unexpected Source interface: ' + json.dumps(doc))
    inputs = [{'name': p['name'], 'dataType': p['typeName'], 'default': p['default'], 'bIsConstructor': p['accessType'] == 'Value'} for p in pins['inputs'] if p['name'] != 'Play']
    for p in inputs:
        if p['name'] == 'Variants': p['default'] = json.dumps(ARGS['variants'])
        if p['name'] == 'VariantIndices': p['default'] = json.dumps(list(range(len(ARGS['variants']))))
        if p['name'] == 'Label': p['default'] = 'Sound variant: ' + asset
    old_inputs = {p['name'] for p in doc['inputs']}
    missing = [p for p in inputs if p['name'] not in old_inputs]
    if missing: await author('AddGraphInputs', builderName=builder, inputs=missing, page='Default')
    outputs = [{'name': p['name'], 'dataType': p['typeName'], 'default': '', 'bIsConstructor': False} for p in pins['outputs'] if p['name'] not in {'Left', 'Right', 'Finished'}]
    old_outputs = {p['name'] for p in doc['outputs']}
    missing = [p for p in outputs if p['name'] not in old_outputs]
    if missing: await author('AddGraphOutputs', builderName=builder, outputs=missing, page='Default')
    if existing:
        await author('SetDefaults', builderName=builder, defaults=[{'node': '', 'pin': p['name'], 'value': p['default'], 'page': 'Default'} for p in inputs if p['name'] in {'Variants', 'VariantIndices'}])
    nodes = await author('AddNodes', builderName=builder, nodes=[{'className': cls}], page='Default')
    ref = nodes['nodes'][0]['ref']
    edges = [{'fromNode': p['name'], 'fromPin': '', 'toNode': ref, 'toPin': p['name']} for p in inputs]
    edges += [{'fromNode': ref, 'fromPin': p['name'], 'toNode': p['name'], 'toPin': ''} for p in outputs]
    edges += [
        {'fromNode': ref, 'fromPin': 'Left', 'toNode': audio[0], 'toPin': ''},
        {'fromNode': ref, 'fromPin': 'Right', 'toNode': audio[1], 'toPin': ''},
        {'fromNode': play[0], 'fromPin': '', 'toNode': ref, 'toPin': 'Play'},
        {'fromNode': ref, 'fromPin': 'Finished', 'toNode': finished[0], 'toPin': ''},
    ]
    await author('Connect', builderName=builder, connections=edges, page='Default')
    await author('LayoutGraph', builderName=builder, page='Default')
    if existing:
        result_path = await author('CommitBuilderToAsset', builderName=builder)
    else:
        result_path = await author('BuildToAsset', builderName=builder, assetName=asset.rsplit('/', 1)[-1], packagePath=asset.rsplit('/', 1)[0], author=ARGS.get('author') or 'jam')
    object_path = asset + '.' + asset.rsplit('/', 1)[-1]
    if result_path not in {asset, object_path}:
        raise RuntimeError('MetaSound save returned a different asset: ' + str(result_path))
    await author('DetachBuilderFromAsset', builderName=builder)
    return {'source': object_path, 'patch': PATCH, 'variants': ARGS['variants']}
