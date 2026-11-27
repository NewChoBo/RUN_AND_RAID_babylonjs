-- Run in Autodesk 3ds Max Batch. The Python launcher scopes input and output to one scene.
(
    local sourceFile = getEnvVariable "RUN_RAID_MAX_INPUT"
    local targetFile = getEnvVariable "RUN_RAID_FBX_OUTPUT"
    if sourceFile == undefined or targetFile == undefined do throw "Missing input/output paths."
    if not (loadMaxFile sourceFile useFileUnits:true quiet:true) do throw "Cannot open MAX scene."
    pluginManager.loadClass FBXEXP
    FBXExporterSetParam "ResetExport"
    FBXExporterSetParam "Animation" true
    FBXExporterSetParam "Skin" true
    FBXExporterSetParam "BakeAnimation" true
    FBXExporterSetParam "BakeFrameStart" (animationRange.start.frame as integer)
    FBXExporterSetParam "BakeFrameEnd" (animationRange.end.frame as integer)
    FBXExporterSetParam "BakeFrameStep" 1
    FBXExporterSetParam "BakeResampleAnimation" true
    FBXExporterSetParam "EmbedTextures" true
    if not (exportFile targetFile #noPrompt selectedOnly:false using:FBXEXP) do throw "FBX export failed."
)
