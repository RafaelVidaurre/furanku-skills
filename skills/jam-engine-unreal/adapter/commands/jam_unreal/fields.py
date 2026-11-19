"""Property values of one export, read from its tagged property serialization without the engine.

An editor package stores each object's properties as a list of tags (name, type, size, flags) each followed by its
value, ending at the name `None`. Only properties whose value differs from the object's archetype (its class
default object, or its template) are saved, so the values read here are what the file itself sets: inherited and
native defaults are not in the file.

Every tagged value carries its size, so a value this reader cannot decode is skipped by size and recorded as
`{"unparsed": "<type>"}`; only a broken tag stream fails the export (`FieldsError`).

How values are encoded in the inventory is documented in docs/inventory.md (Property values).
"""
import datetime
import math
import struct

LARGE_WORLD_COORDINATES = 1004            # vectors, rotators and quats hold doubles from here
PROPERTY_TAG_EXTENSION = 1011             # tags and objects gain extension bytes
PROPERTY_TAG_COMPLETE_TYPE_NAME = 1012    # tags hold the full type tree and a flags byte

FLAG_ARRAY_INDEX, FLAG_GUID, FLAG_EXTENSIONS, FLAG_NATIVE, FLAG_BOOL_TRUE, FLAG_SKIPPED = 0x01, 0x02, 0x04, 0x08, 0x10, 0x20
EXTENSION_OVERRIDABLE, EXTENSION_EXTERNAL_OBJECTS = 0x02, 0x04
CLASS_EXTENSION_OVERRIDABLE = 0x02

# custom versions (summary GUID -> version) the decoders branch on
FORTNITE_MAIN = "601D1886AC644F84AA16D3DE0DEAC7D6"
UE5_RELEASE_STREAM = "D89B5E4224BD4D468412ACA8DF641779"
ADD_DEV_NOTES_TO_FTEXT = 260                  # FortniteMain: a text's base history adds its dev notes
DYNAMIC_DELEGATE_PAYLOADS = 262               # FortniteMain: a delegate is followed by a has-payload bool
COMPACT_DYNAMIC_DELEGATE_PAYLOADS = 263       # FortniteMain: the payload flag moves into the function name
TEXT_FORMAT_ARGUMENT_DATA_64BIT = 12          # UE5ReleaseStream: integer format arguments are 64-bit
PIN_TYPE_SINGLE_PRECISION_FLAG = 36           # UE5ReleaseStream: a pin type ends in its single-precision flag
MATERIAL_INPUT_USES_LINEAR_COLOR = 171        # FortniteMain: a color material input's constant is a linear color
SERIALIZE_FLOAT_CHANNEL_SHOW_CURVE = 53       # FortniteMain: a curve channel ends in its show-curve flag
PAYLOAD_SUFFIX = "[bHasPayload]"

INTEGERS = {"Int8Property": "<b", "Int16Property": "<h", "IntProperty": "<i", "Int64Property": "<q",
            "UInt16Property": "<H", "UInt32Property": "<I", "UInt64Property": "<Q"}
OBJECTS = ("ObjectProperty", "ObjectPtrProperty", "ClassProperty", "ClassPtrProperty", "WeakObjectProperty", "InterfaceProperty")
SOFT_OBJECTS = ("SoftObjectProperty", "SoftClassProperty")
STRINGS = ("StrProperty", "Utf8StrProperty", "AnsiStrProperty")
DELEGATE_LISTS = ("MulticastDelegateProperty", "MulticastInlineDelegateProperty", "MulticastSparseDelegateProperty")


def number(value, single=False):
    """A float as JSON holds it: a single-precision value in its shortest form (0.4, not 0.4000000059604645);
    infinities and NaN, which JSON cannot hold, as the strings "Infinity", "-Infinity" and "NaN"."""
    if math.isnan(value):
        return "NaN"
    if math.isinf(value):
        return "Infinity" if value > 0 else "-Infinity"
    if single:
        for digits in range(6, 10):
            short = float("%.*g" % (digits, value))
            if struct.unpack("<f", struct.pack("<f", short))[0] == value:
                return short
    return value


class FieldsError(Exception):
    """The export's property stream does not parse."""


class _Unparsed(Exception):
    """One value this reader does not decode; it is skipped by size."""


class _Cursor:
    def __init__(self, data, names):
        self.data, self.names, self.pos = data, names, 0

    def take(self, n):
        if n < 0 or self.pos + n > len(self.data):
            raise FieldsError("read past the end of the export")
        out = self.data[self.pos:self.pos + n]
        self.pos += n
        return out

    def unpack(self, fmt):
        size = struct.calcsize(fmt)
        if self.pos + size > len(self.data):
            raise FieldsError("read past the end of the export")
        out = struct.unpack_from(fmt, self.data, self.pos)
        self.pos += size
        return out if len(out) > 1 else out[0]

    def u8(self):
        return self.unpack("<B")

    def i32(self):
        return self.unpack("<i")

    def u32(self):
        return self.unpack("<I")

    def name(self):
        index, number = self.unpack("<ii")
        if not 0 <= index < len(self.names):
            raise FieldsError("name index %d of %d" % (index, len(self.names)))
        return self.names[index] if number == 0 else "%s_%d" % (self.names[index], number - 1)

    def string(self):
        n = self.i32()
        if n == 0:
            return ""
        if n > 0:
            raw = self.take(n).rstrip(b"\0")
            try:
                return raw.decode("utf-8")
            except UnicodeDecodeError:
                return raw.decode("latin-1")
        return self.take(-2 * n).decode("utf-16-le").rstrip("\0")

    def guid(self):
        return "%08X%08X%08X%08X" % self.unpack("<IIII")


class Package:
    """What a value needs from the package header: names, imports, exports, the soft object path list and the
    custom versions ({GUID: version}) some native layouts depend on."""

    def __init__(self, package, ue5, names, imports, exports, soft_paths, custom=None):
        self.package, self.ue5, self.names = package, ue5, names
        self.imports, self.exports, self.soft_paths = imports, exports, soft_paths
        self.custom = custom or {}

    def version(self, guid):
        return self.custom.get(guid, 0)

    def object_path(self, index):
        """The engine id of the object a package index points at: `/Game/Pkg.Asset` or `/Game/Pkg.Asset:Sub.Inner`."""
        chain, package = [], None
        for _ in range(len(self.imports) + len(self.exports) + 1):
            if index < 0 and -index - 1 < len(self.imports):
                entry = self.imports[-index - 1]
                if entry["outer"] == 0:
                    package = entry["name"]
                    break
            elif 0 < index <= len(self.exports):
                entry = self.exports[index - 1]
                if entry["outer"] == 0:
                    package = self.package
                    chain.append(entry["name"])
                    break
            else:
                raise FieldsError("object index %d is outside the package tables" % index)
            chain.append(entry["name"])
            index = entry["outer"]
        else:
            raise FieldsError("object index %d has a cycle of outers" % index)
        chain.reverse()
        if not chain:
            return package
        return package + "." + chain[0] + (":" + ".".join(chain[1:]) if len(chain) > 1 else "")

    def class_path(self, index):
        """The class of an object a package index points at: an import's own class, an export's class index."""
        if index < 0:
            imp = self.imports[-index - 1]
            return "%s.%s" % (imp["class_package"], imp["class"])
        if index == 0:
            return "/Script/CoreUObject.Class"
        return self.object_path(self.exports[index - 1]["class"]) if self.exports[index - 1]["class"] else "/Script/CoreUObject.Class"


class _Tag:
    __slots__ = ("name", "type", "size", "index", "bool", "native", "overridable")


def _type_name(c):
    """The full type tree (UE5 1012+): nodes of (name, inner count) in prefix order."""
    flat, remaining = [], 1
    while remaining > 0:
        name, inner = c.name(), c.i32()
        if inner < 0 or len(flat) > 64:
            raise FieldsError("malformed property type")
        flat.append((name, inner))
        remaining += inner - 1

    def build(i):
        name, inner = flat[i]
        params, i = [], i + 1
        for _ in range(inner):
            node, i = build(i)
            params.append(node)
        return (name, params), i
    return build(0)[0]


def type_text(node):
    name, params = node
    return name + ("(%s)" % ",".join(type_text(p) for p in params) if params else "")


def _extensions(c, tag):
    extensions = c.u8()
    if extensions & EXTENSION_OVERRIDABLE:
        c.u8()  # override operation
        tag.overridable = c.u32() != 0
    if extensions & EXTENSION_EXTERNAL_OBJECTS:
        c.u32()


def _tag(c, ue5):
    name = c.name()
    if name == "None":
        return None
    tag = _Tag()
    tag.name, tag.bool, tag.native, tag.overridable = name, False, None, False
    if ue5 >= PROPERTY_TAG_COMPLETE_TYPE_NAME:
        tag.type = _type_name(c)
        tag.size, flags = c.i32(), c.u8()
        tag.index = c.i32() if flags & FLAG_ARRAY_INDEX else 0
        if flags & FLAG_GUID:
            c.take(16)
        if flags & FLAG_EXTENSIONS:
            _extensions(c, tag)
        tag.bool, tag.native = bool(flags & FLAG_BOOL_TRUE), bool(flags & FLAG_NATIVE)
        if flags & FLAG_SKIPPED:
            tag.size = -1
        return tag
    kind = c.name()
    tag.size, tag.index = c.i32(), c.i32()
    params = []
    if kind == "StructProperty":
        params = [(c.name(), [])]
        c.take(16)
    elif kind == "BoolProperty":
        tag.bool = c.u8() != 0
    elif kind in ("ByteProperty", "EnumProperty"):
        enum = c.name()
        params = [] if enum == "None" else [(enum, [])]
    elif kind in ("ArrayProperty", "SetProperty", "OptionalProperty"):
        params = [(c.name(), [])]
    elif kind == "MapProperty":
        params = [(c.name(), []), (c.name(), [])]
    tag.type = (kind, params)
    if c.u8():
        c.take(16)
    if ue5 >= PROPERTY_TAG_EXTENSION:
        _extensions(c, tag)
    return tag


# ---- natively serialized structs this reader decodes: (cursor, context, size when known, property path) -> value
def _floats(names, wide):
    def read(c, ctx, size, path):
        double = wide and (ctx.ue5 >= LARGE_WORLD_COORDINATES if size is None else size == 8 * len(names))
        values = c.unpack("<" + ("d" if double else "f") * len(names))
        return {n: number(v, not double) for n, v in zip(names, values)}
    return read


def _ints(names, fmt):
    return lambda c, ctx, size, path: dict(zip(names, c.unpack("<" + fmt * len(names))))


def _color(c, ctx, size, path):
    b, g, r, a = c.unpack("<BBBB")
    return {"R": r, "G": g, "B": b, "A": a}


def _box(vector):
    def read(c, ctx, size, path):
        half = None if size is None else (size - 1) // 2
        return {"Min": vector(c, ctx, half, path), "Max": vector(c, ctx, half, path), "IsValid": c.u8() != 0}
    return read


def _per_platform(fmt, single=False):
    """PerPlatformInt/Float/Bool: a cooked flag, the default, and in editor packages the overrides by platform."""
    def read(c, ctx, size, path):
        cooked = c.u32() != 0
        decode = (lambda: c.u32() != 0) if fmt == "bool" else (lambda: number(c.unpack(fmt), single) if single else c.unpack(fmt))
        out = {"Default": decode()}
        if not cooked:
            n = _count(c, len(c.data))
            out["PerPlatform"] = {c.name(): decode() for _ in range(n)}
        return out
    return read


def _instanced_struct(c, ctx, size, path):
    """FInstancedStruct: the struct type, its size, then its value (tagged, unless a struct this reader decodes)."""
    index, n = c.i32(), c.i32()
    struct_path = ctx.package.object_path(index) if index else None
    end = c.pos + n
    if n < 0 or end > len(c.data):
        raise _Unparsed()
    if struct_path is None:
        c.pos = end
        return None
    if not ctx.package.class_path(index).endswith(("ScriptStruct", "UserDefinedStruct")):
        raise _Unparsed()
    name = struct_path.rsplit(".", 1)[-1]
    refs = len(ctx.refs)
    try:
        value = _struct(c, ctx, ("StructProperty", [(name, [])]), path + ".value", None, n)
        if c.pos != end:
            raise _Unparsed()
    except (_Unparsed, FieldsError, struct.error, UnicodeDecodeError, IndexError):
        del ctx.refs[refs:]
        value = {"unparsed": "StructProperty(%s)" % name}
        c.pos = end
    return {"struct": struct_path, "value": value}


def _tag_container(c, ctx, size, path):
    n = c.i32()
    if n < 0 or n * 8 > len(c.data) - c.pos:
        raise _Unparsed()
    return [c.name() for _ in range(n)]


def _top_level_asset_path(c, ctx, size, path):
    package, asset = c.name(), c.name()
    return "" if package == "None" else package + ("." + asset if asset != "None" else "")


def _frame_rate(c):
    numerator, denominator = c.unpack("<ii")
    return {"Numerator": numerator, "Denominator": denominator}


def _per_platform_frame_rate(c, ctx, size, path):
    cooked = c.u32() != 0
    out = {"Default": _frame_rate(c)}
    if not cooked:
        n = _count(c, len(c.data))
        out["PerPlatform"] = {c.name(): _frame_rate(c) for _ in range(n)}
    return out


def _bool32(c):
    return c.u32() != 0


def _terminal_type(c, ctx, path):
    """FEdGraphTerminalType: a map pin's value type."""
    return {"TerminalCategory": c.name(), "TerminalSubCategory": c.name(),
            "TerminalSubCategoryObject": _object(c, ctx, path + ".TerminalSubCategoryObject"),
            "bTerminalIsConst": _bool32(c), "bTerminalIsWeakPointer": _bool32(c), "bTerminalIsUObjectWrapper": _bool32(c)}


def _pin_type(c, ctx, size, path):
    """FEdGraphPinType, a Blueprint variable's or pin's type (FEdGraphPinType::Serialize, UE5 layout)."""
    out = {"PinCategory": c.name(), "PinSubCategory": c.name(), "PinSubCategoryObject": _object(c, ctx, path + ".PinSubCategoryObject")}
    container = c.u8()
    if container > 3:
        raise _Unparsed()
    out["ContainerType"] = "EPinContainerType::" + ("None", "Array", "Set", "Map")[container]
    if container == 3:
        out["PinValueType"] = _terminal_type(c, ctx, path + ".PinValueType")
    out["bIsReference"], out["bIsWeakPointer"] = _bool32(c), _bool32(c)
    out["PinSubCategoryMemberReference"] = {"MemberParent": _object(c, ctx, path + ".PinSubCategoryMemberReference.MemberParent"),
                                            "MemberName": c.name(), "MemberGuid": c.guid()}
    out["bIsConst"], out["bIsUObjectWrapper"] = _bool32(c), _bool32(c)
    if ctx.package.version(UE5_RELEASE_STREAM) >= PIN_TYPE_SINGLE_PRECISION_FLAG:
        out["bSerializeAsSinglePrecisionFloat"] = _bool32(c)
    return out


def _sampling_built_data(c, ctx, size, path):
    """FSkeletalMeshSamplingLODBuiltData: an alias table over the mesh's triangles, as its size and total weight."""
    samples = _count(c, len(c.data))
    c.take(4 * samples)
    if _count(c, len(c.data)) != samples:
        raise _Unparsed()
    c.take(4 * samples)
    return {"samples": samples, "TotalWeight": number(c.unpack("<f"), True)}


def _slate_vector(c, ctx, size, path):
    return {n: number(v, True) for n, v in zip(("X", "Y"), c.unpack("<ff"))}


def _frame_range(c, ctx, size, path):
    """FMovieSceneFrameRange: two bounds, each a type byte and a frame number."""
    out = {}
    for key in ("LowerBound", "UpperBound"):
        kind, value = c.unpack("<Bi")
        if kind > 2:
            raise _Unparsed()
        out[key] = {"Type": ("Exclusive", "Inclusive", "Open")[kind], "Value": value}
    return out


def _curve_channel(default_format):
    """FMovieScene(Float|Double)Channel: keys stored as raw arrays, summarized as their count, the default value and
    the tick resolution (TMovieSceneCurveChannelImpl::Serialize)."""
    def read(c, ctx, size, path):
        extrapolation = c.unpack("<BB")
        keys = None
        for _ in range(2):  # times, then values: element size, count, raw elements
            element, n = c.unpack("<ii")
            if element <= 0 or n < 0 or (keys is not None and n != keys):
                raise _Unparsed()
            c.take(element * n)
            keys = n
        default = number(c.unpack(default_format), default_format == "<f")
        out = {"keys": keys}
        if _bool32(c):
            out["DefaultValue"] = default
        out["TickResolution"] = _frame_rate(c)
        if ctx.package.version(FORTNITE_MAIN) >= SERIALIZE_FLOAT_CHANNEL_SHOW_CURVE:
            c.u32()
        out["PreInfinityExtrap"], out["PostInfinityExtrap"] = extrapolation
        return out
    return read


def _expression_input(c, ctx, path):
    """FExpressionInput: the material expression feeding an input, and which of its outputs."""
    out = {"Expression": _object(c, ctx, path + ".Expression"), "OutputIndex": c.i32(), "InputName": c.name()}
    for key in ("Mask", "MaskR", "MaskG", "MaskB", "MaskA"):
        out[key] = c.i32()
    return out


def _material_input(constant):
    """FMaterialInput<T>: an expression input, then whether a constant stands in for it and that constant."""
    def read(c, ctx, size, path):
        out = _expression_input(c, ctx, path)
        out["UseConstant"] = _bool32(c)
        out["Constant"] = constant(c, ctx)
        return out
    return read


def _color_constant(c, ctx):
    if ctx.package.version(FORTNITE_MAIN) < MATERIAL_INPUT_USES_LINEAR_COLOR:
        return _color(c, ctx, 4, "")
    return {n: number(v, True) for n, v in zip("RGBA", c.unpack("<ffff"))}


SOFT_STRUCTS = ("SoftObjectPath", "SoftClassPath", "StringAssetReference", "StringClassReference")
_VECTOR = _floats(("X", "Y", "Z"), True)
_VECTOR2 = _floats(("X", "Y"), True)
NATIVE = {
    "Vector": _VECTOR, "Vector3d": _VECTOR, "Vector3f": _floats(("X", "Y", "Z"), False),
    "Vector2D": _VECTOR2, "Vector2d": _VECTOR2, "Vector2f": _floats(("X", "Y"), False),
    "Vector4": _floats(("X", "Y", "Z", "W"), True), "Vector4d": _floats(("X", "Y", "Z", "W"), True), "Vector4f": _floats(("X", "Y", "Z", "W"), False),
    "Rotator": _floats(("Pitch", "Yaw", "Roll"), True), "Rotator3d": _floats(("Pitch", "Yaw", "Roll"), True), "Rotator3f": _floats(("Pitch", "Yaw", "Roll"), False),
    "Quat": _floats(("X", "Y", "Z", "W"), True), "Quat4d": _floats(("X", "Y", "Z", "W"), True), "Quat4f": _floats(("X", "Y", "Z", "W"), False),
    "LinearColor": _floats(("R", "G", "B", "A"), False),
    "Color": _color,
    "Guid": lambda c, ctx, size, path: c.guid(),
    "IntPoint": _ints(("X", "Y"), "i"), "IntVector": _ints(("X", "Y", "Z"), "i"), "IntVector4": _ints(("X", "Y", "Z", "W"), "i"),
    "Box": _box(_VECTOR), "Box2D": _box(_VECTOR2),
    "DateTime": lambda c, ctx, size, path: c.unpack("<q"), "Timespan": lambda c, ctx, size, path: c.unpack("<q"),
    "FrameNumber": lambda c, ctx, size, path: c.i32(),
    "PerPlatformInt": _per_platform("<i"), "PerPlatformFloat": _per_platform("<f", True), "PerPlatformBool": _per_platform("bool"),
    "PerPlatformFrameRate": _per_platform_frame_rate,
    "InstancedStruct": _instanced_struct,
    "TopLevelAssetPath": _top_level_asset_path,
    "GameplayTagContainer": _tag_container,
    "EdGraphPinType": _pin_type,
    "SkeletalMeshSamplingLODBuiltData": _sampling_built_data,
    "DeprecateSlateVector2D": _slate_vector,
    "MovieSceneFrameRange": _frame_range,
    "MovieSceneFloatChannel": _curve_channel("<f"), "MovieSceneDoubleChannel": _curve_channel("<d"),
    "ExpressionInput": lambda c, ctx, size, path: _expression_input(c, ctx, path),
    "MaterialAttributesInput": lambda c, ctx, size, path: _expression_input(c, ctx, path),
    "ScalarMaterialInput": _material_input(lambda c, ctx: number(c.unpack("<f"), True)),
    "ShadingModelMaterialInput": _material_input(lambda c, ctx: c.u32()),
    "SubstrateMaterialInput": _material_input(lambda c, ctx: c.u32()),
    "VectorMaterialInput": _material_input(lambda c, ctx: {n: number(v, True) for n, v in zip("XYZ", c.unpack("<fff"))}),
    "Vector2MaterialInput": _material_input(lambda c, ctx: {n: number(v, True) for n, v in zip("XY", c.unpack("<ff"))}),
    "ColorMaterialInput": _material_input(_color_constant),
}


# ---- values
class _Context:
    def __init__(self, package, refs):
        self.package, self.ue5, self.refs = package, package.ue5, refs


def _soft(c, ctx, path=None):
    if ctx.package.soft_paths:
        index = c.i32()
        if not 0 <= index < len(ctx.package.soft_paths):
            raise FieldsError("soft object path index %d of %d" % (index, len(ctx.package.soft_paths)))
        target = ctx.package.soft_paths[index]
    else:
        target = read_soft_object_path(c.name, c.string)
    if not target:
        return None
    if path is not None:
        ctx.refs.append({"property": path, "to": target, "kind": "soft"})
    return {"soft": target}


def read_soft_object_path(name, string):
    """One FSoftObjectPath as it is stored (package name, asset name, sub-path), as an engine id; "" when empty."""
    package, asset, sub = name(), name(), string()
    if package == "None":
        return ""
    return package + ("." + asset if asset != "None" else "") + (":" + sub if sub else "")


def _object(c, ctx, path):
    index = c.i32()
    if index == 0:
        return None
    target = ctx.package.object_path(index)
    ctx.refs.append({"property": path, "to": target, "kind": "native" if target.startswith("/Script/") else "hard"})
    out = {"object": target}
    cls = ctx.package.class_path(index)
    if cls:
        out["class"] = cls
    return out


def _text(c, ctx):
    """One FText by its history (FTextHistory_*::Serialize): its source string, or what built it."""
    c.i32()  # flags
    history = struct.unpack("<b", c.take(1))[0]
    if history == -1:
        return c.string() if c.u32() else ""
    if history == 0:
        c.string(); c.string()  # namespace, key
        source = c.string()
        if ctx.package.version(FORTNITE_MAIN) >= ADD_DEV_NOTES_TO_FTEXT:
            c.string()  # dev notes
        return source
    if history in (1, 2, 3):  # named, ordered, argument-data format
        out = {"format": _text(c, ctx)}
        n = _count(c, len(c.data))
        if history == 1:
            out["args"] = {c.string(): _format_value(c, ctx) for _ in range(n)}
        elif history == 2:
            out["args"] = [_format_value(c, ctx) for _ in range(n)]
        else:
            out["args"] = {c.string(): _format_data(c, ctx) for _ in range(n)}
        return out
    if history in (4, 5, 6):  # as number, percent, currency
        currency = c.string() if history == 6 else None
        out = {("asNumber", "asPercent", "asCurrency")[history - 4]: _format_value(c, ctx)}
        if currency is not None:
            out["currency"] = currency
        if c.u32():  # number formatting options
            c.u32(); c.u32(); c.take(1); c.unpack("<iiii")
        culture = c.string()
        if culture:
            out["culture"] = culture
        return out
    if history in (7, 8, 9):  # as date, time, date and time
        ticks = c.unpack("<q")
        styles = c.take(2 if history == 9 else 1)
        if history == 9 and styles[0] == 5:  # EDateTimeStyle::Custom
            c.string()
        c.string()  # time zone
        out = {("asDate", "asTime", "asDateTime")[history - 7]: _ticks(ticks)}
        culture = c.string()
        if culture:
            out["culture"] = culture
        return out
    if history == 10:  # transform
        inner = _text(c, ctx)
        kind = c.u8()
        if kind > 1:
            raise _Unparsed()
        return {"transform": ("ToLower", "ToUpper")[kind], "text": inner}
    if history == 11:
        table = c.name()
        return {"table": table, "key": c.string()}
    raise _Unparsed()


def _ticks(ticks):
    """FDateTime ticks (100 ns since 0001-01-01) as an ISO 8601 date and time."""
    try:
        return (datetime.datetime(1, 1, 1) + datetime.timedelta(microseconds=ticks // 10)).isoformat()
    except OverflowError:
        raise _Unparsed()


def _format_value(c, ctx):
    """FFormatArgumentValue: a typed argument of a formatted text."""
    kind = struct.unpack("<b", c.take(1))[0]
    if kind == 0:
        return c.unpack("<q")
    if kind in (1, 5):  # unsigned, gender
        return c.unpack("<Q")
    if kind == 2:
        return number(c.unpack("<f"), True)
    if kind == 3:
        return number(c.unpack("<d"))
    if kind == 4:
        return _text(c, ctx)
    raise _Unparsed()


def _format_data(c, ctx):
    """FFormatArgumentData's value, after its name."""
    kind = c.u8()
    if kind == 0:
        return c.unpack("<q") if ctx.package.version(UE5_RELEASE_STREAM) >= TEXT_FORMAT_ARGUMENT_DATA_64BIT else c.i32()
    if kind == 2:
        return number(c.unpack("<f"), True)
    if kind == 3:
        return number(c.unpack("<d"))
    if kind == 4:
        return _text(c, ctx)
    if kind == 5:
        return c.u8()
    raise _Unparsed()


def _delegate(c, ctx, path):
    """One bound function (TScriptDelegate): the object it is bound to and the function's name."""
    target = _object(c, ctx, path)
    function = c.name()
    version = ctx.package.version(FORTNITE_MAIN)
    if DYNAMIC_DELEGATE_PAYLOADS <= version < COMPACT_DYNAMIC_DELEGATE_PAYLOADS and c.u32():
        raise _Unparsed()  # a payload this reader does not decode
    if version >= COMPACT_DYNAMIC_DELEGATE_PAYLOADS and function.endswith(PAYLOAD_SUFFIX):
        raise _Unparsed()
    return {"function": function, "target": target}


def _field_path(c, ctx, path):
    """TFieldPath: the field's names, innermost first, then the struct that owns it."""
    names = [c.name() for _ in range(_count(c, len(c.data)))]
    owner = c.i32()
    if not names or names == ["None"] or owner == 0:
        return None
    return {"field": ctx.package.object_path(owner) + ":" + ".".join(reversed(names))}


def _value(c, ctx, node, path, tag=None, native=None, size=None):
    """One value of type `node`. `tag` is set for a value directly under a property tag (a bool's value is then in
    the tag); `native` says whether a struct is natively serialized, when the package says so."""
    kind, params = node
    if kind == "BoolProperty":
        return tag.bool if tag is not None else c.u8() != 0
    if kind in INTEGERS:
        return c.unpack(INTEGERS[kind])
    if kind == "FloatProperty":
        return number(c.unpack("<f"), True)
    if kind == "DoubleProperty":
        return number(c.unpack("<d"))
    if kind == "ByteProperty":
        if params or size == 8:
            return c.name()
        return c.u8()
    if kind in ("EnumProperty", "NameProperty"):
        return c.name()
    if kind in STRINGS:
        return c.string()
    if kind == "TextProperty":
        return _text(c, ctx)
    if kind == "DelegateProperty":
        return _delegate(c, ctx, path)
    if kind in DELEGATE_LISTS:
        return [_delegate(c, ctx, "%s[%d]" % (path, i)) for i in range(_count(c, len(c.data)))]
    if kind == "FieldPathProperty":
        return _field_path(c, ctx, path)
    if kind in OBJECTS:
        return _object(c, ctx, path)
    if kind in SOFT_OBJECTS:
        return _soft(c, ctx, path)
    if kind == "StructProperty":
        return _struct(c, ctx, node, path, native, size)
    if kind in ("ArrayProperty", "SetProperty", "MapProperty"):
        if tag is not None and tag.overridable:
            raise _Unparsed()
        return _container(c, ctx, node, path, tag, size)
    if kind == "OptionalProperty" and params and ctx.ue5 >= PROPERTY_TAG_COMPLETE_TYPE_NAME:
        return _value(c, ctx, params[0], path, native=None if tag is None else tag.native) if c.u32() else None
    raise _Unparsed()


def _struct(c, ctx, node, path, native, size):
    name = node[1][0][0] if node[1] else None
    if native or (native is None and (name in NATIVE or name in SOFT_STRUCTS)):
        if name in SOFT_STRUCTS:
            return _soft(c, ctx, path)
        if name in NATIVE:
            return NATIVE[name](c, ctx, size, path)
        # Many native serializers write the struct's tagged properties themselves (sync markers, retarget
        # settings): read them as tagged, and trust that only when they end where the value ends.
        start = c.pos
        try:
            value = _properties(c, ctx, path + ".")
        except (FieldsError, struct.error, UnicodeDecodeError, IndexError):
            raise _Unparsed()
        if size is not None and c.pos - start != size:
            raise _Unparsed()
        return value
    value = _properties(c, ctx, path + ".")
    if name == "GameplayTag" and set(value) <= {"TagName"}:
        return value.get("TagName", "")
    return value


def _container(c, ctx, node, path, tag, size):
    kind, params = node
    end = c.pos + size if size is not None else len(c.data)
    if kind == "MapProperty":
        key_node, value_node = params
        # A map's native flag covers its key and its value: decode the structs this reader knows natively, the
        # rest as tagged.
        native = None if tag is None or tag.native is None else (None if tag.native else False)
        if c.i32() != 0:
            raise _Unparsed()  # keys removed from the archetype's map
        out = []
        for i in range(_count(c, end)):
            key = _value(c, ctx, key_node, "%s[%d].key" % (path, i), native=native)
            out.append({"key": key, "value": _value(c, ctx, value_node, "%s[%d].value" % (path, i), native=native)})
        return out
    inner = params[0]
    native = None if tag is None else tag.native
    if kind == "SetProperty" and c.i32() != 0:
        raise _Unparsed()  # elements removed from the archetype's set
    n = _count(c, end)
    if kind == "ArrayProperty" and inner[0] == "StructProperty" and ctx.ue5 < PROPERTY_TAG_COMPLETE_TYPE_NAME:
        inner_tag = _tag(c, ctx.ue5)
        if inner_tag is None:
            raise _Unparsed()
        inner = inner_tag.type
    element = None
    if inner[0] == "ByteProperty" and not inner[1] and n:
        element = (end - c.pos) // n  # an untyped byte array before 1012: bytes or enum names
    return [_value(c, ctx, inner, "%s[%d]" % (path, i), native=native, size=element) for i in range(n)]


def _count(c, end):
    n = c.i32()
    if n < 0 or n > end - c.pos:
        raise _Unparsed()
    return n


def _properties(c, ctx, prefix, select=None):
    """Tagged properties up to the `None` tag, by name (`Name[i]` for a static array's element i > 0)."""
    out = {}
    while True:
        tag = _tag(c, ctx.ue5)
        if tag is None:
            return out
        if tag.size == -1:  # skipped by the saver: no value follows
            continue
        start, end = c.pos, c.pos + tag.size
        if tag.size < 0 or end > len(c.data):
            raise FieldsError("property %s has size %d past the end of the export" % (tag.name, tag.size))
        key = tag.name if tag.index == 0 else "%s[%d]" % (tag.name, tag.index)
        if select is None or tag.name in select:
            refs = len(ctx.refs)
            try:
                value = _value(c, ctx, tag.type, prefix + key, tag=tag, native=tag.native, size=tag.size)
                if c.pos != end:
                    raise _Unparsed()
            except (_Unparsed, FieldsError, struct.error, UnicodeDecodeError, IndexError, RecursionError):
                del ctx.refs[refs:]
                value = {"unparsed": type_text(tag.type)}
            out[key] = value
        c.pos = end


def read_fields(data, package, select=None):
    """(fields, references) of one export's script properties (`data` starts at them). `select` is a set of
    top-level property names, or None for all of them. Raises FieldsError when the tag stream is broken."""
    c = _Cursor(data, package.names)
    refs = []
    ctx = _Context(package, refs)
    try:
        if package.ue5 >= PROPERTY_TAG_EXTENSION:
            if c.u8() & CLASS_EXTENSION_OVERRIDABLE:
                c.u8()  # overridable operation
        fields = _properties(c, ctx, "", select)
    except (struct.error, UnicodeDecodeError, RecursionError) as e:
        raise FieldsError(str(e))
    return fields, refs
