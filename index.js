"use strict";
exports.__esModule = true;
var fs = require("fs");
var child_process_1 = require("child_process");
process.chdir("C:\\coding\\Node.js\\MindustryLauncher");
var settings = parseJSONC(fs.readFileSync("config.json", "utf-8"));
var mindustryProcess;
var currentLogStream;
function parseArgs(args) {
    var parsedArgs = {};
    var argName = "null";
    for (var _i = 0, args_1 = args; _i < args_1.length; _i++) {
        var arg = args_1[_i];
        if (arg.startsWith("--")) {
            argName = arg.slice(2);
            parsedArgs[arg.toLowerCase().slice(2)] = "null";
        }
        else if (argName) {
            parsedArgs[argName] = arg.toLowerCase();
            argName = "null";
        }
    }
    return parsedArgs;
}
function startProcess(_filePath, _jvmArgs) {
    var proc = (0, child_process_1.spawn)("java", ["-jar " + _filePath].concat(_jvmArgs).join(" ").split(" "));
    var d = new Date();
    currentLogStream = fs.createWriteStream("" + settings.logging.path + d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate() + "--" + d.getHours() + "-" + d.getMinutes() + "-" + d.getSeconds() + ".txt");
    proc.stdout.pipe(process.stdout);
    proc.stdout.pipe(currentLogStream);
    proc.stderr.pipe(process.stderr);
    return proc;
}
function restart(_filePath, _jvmArgs) {
    console.log("Restarting!");
    mindustryProcess.removeAllListeners();
    mindustryProcess.kill("SIGTERM"); //todo see if this causes issues
    mindustryProcess = startProcess(_filePath, _jvmArgs);
    console.log("Started new process.");
}
function copyMods() {
    for (var _i = 0, _a = settings.externalMods; _i < _a.length; _i++) {
        var file = _a[_i];
        console.log("Copying mod " + file);
        var modname = file.match(/(?<=[/\\])[^/\\:*?"<>]+?(?=(Desktop)?\.jar$)/i); //hello regex my old friend
        if (modname == null) {
            throw new Error("Invalid mod filename " + file + "!");
        }
        fs.copyFileSync(file, process.env["appdata"] + "\\Mindustry\\mods\\" + modname[0] + ".jar");
    }
}
function main() {
    var _a;
    var state = "normal";
    for (var _i = 0, _b = Object.entries(settings.mindustryJars.versionNames); _i < _b.length; _i++) {
        var _c = _b[_i], version = _c[0], jarName_1 = _c[1];
        if (jarName_1.includes(" ")) {
            throw new Error("Jar name for version " + version + " contains a space.");
        }
    }
    var parsedArgs = parseArgs(process.argv.slice(2));
    if (parsedArgs["help"]) {
        console.log("Usage: mindustry [--help] [--version <version>]\n\t--help\tDisplays this help message and exits.\n\t--version\tSpecifies the version to use.");
        process.exit();
    }
    var jarName = (_a = settings.mindustryJars.versionNames[parsedArgs["version"]]) !== null && _a !== void 0 ? _a : settings.mindustryJars.versionNames["135"];
    var filePath = jarName.match(/[/\\]/gi) ? jarName : settings.mindustryJars.folderPath + jarName;
    console.log("Launching Mindustry version " + (settings.mindustryJars.versionNames[parsedArgs["version"]] ? parsedArgs["version"] : "135"));
    copyMods();
    mindustryProcess = startProcess(filePath, settings.jvmArgs);
    process.stdin.on("data", function (data) {
        switch (data.toString("utf-8").slice(0, -2)) {
            case "rs":
            case "restart":
                restart(filePath, settings.jvmArgs);
                break;
            default:
                console.log("Unknown command.");
                break;
        }
    });
    mindustryProcess.on("exit", function (statusCode) {
        if (statusCode == 0) {
            console.log("Process exited.");
        }
        else {
            console.log("Process crashed with exit code " + statusCode + "!");
        }
        process.exit();
    });
    for (var _d = 0, _e = settings.externalMods; _d < _e.length; _d++) {
        var file = _e[_d];
        fs.watchFile(file, function () {
            console.log("File change detected! (" + file + ")");
            copyMods();
            if (settings.restartAutomaticallyOnModUpdate)
                restart(filePath, settings.jvmArgs);
        });
    }
}
main();
function parseJSONC(data) {
    return JSON.parse(data.split("\n")
        .filter(function (line) { return !/^[ \t]*\/\//.test(line); })
        .join("\n"));
    //Removes lines that start with any amount of whitespaces and two forward slashes(comments).
}
