/******************************
 *
 * This program is free software:
 * you can redistribute it and/or modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation, either version 3 of the License,
 * or (at your option) any later version.
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 * You should have received a copy of the GNU General Public License along with this program.
 * If not, see <https://www.gnu.org/licenses/>.
 *
 */
import * as fs from "fs";
import { spawn, execSync } from "child_process";
import * as readline from "readline";
import * as https from "https";
import { Stream } from "stream";
import * as path from "path";
const ANSIEscape = {
    "red": `\u001b[0;31m`,
    "yellow": `\u001b[0;93m`,
    "green": `\u001b[0;92m`,
    "blue": `\u001b[0;34m`,
    "purple": `\u001b[0;35m`,
    "white": `\u001b[0;97m`,
    "gray": `\u001b[0;90m`,
    "black": `\u001b[0;30m`,
    "cyan": `\u001b[0;36m`,
    "reset": `\u001b[0m`,
    "brightpurple": `\u001b[0;95m`
};
function log(message) {
    console.log(`${ANSIEscape.blue}[Launcher]${ANSIEscape.reset} ${message}`);
}
function error(message) {
    console.error(`${ANSIEscape.blue}[Launcher]${ANSIEscape.reset} ${message}`);
}
function getLogHighlight(char) {
    switch (char) {
        case "I":
            return ANSIEscape.white;
        case "D":
            return ANSIEscape.gray;
        case "W":
            return ANSIEscape.yellow;
        case "E":
            return ANSIEscape.red;
        default:
            return ANSIEscape.white;
    }
}
function getTimeComponent(highlighted) {
    if (highlighted)
        return `${ANSIEscape.cyan}[${new Date().toTimeString().split(" ")[0]}]${ANSIEscape.reset}`;
    else
        return `[${new Date().toTimeString().split(" ")[0]}]`;
}
function formatLine(line) {
    return `${getTimeComponent(true)} ${getLogHighlight(line.toString()[1])}${line}`;
}
/**
 * Generates a chunk processor function from a function that processes one line at a time.
 * Does not work correctly.
 * */
function chunkProcessorGenerator(processor) {
    return function (chunk) {
        if (chunk == "")
            return "";
        if (chunk.match(/^\r?\n$/))
            return chunk;
        return chunk.split(/(?<=\r?\n)/)
            .map(processor)
            .join("")
            + ANSIEscape.reset;
    };
}
/**Creates a (? extends Stream.Transform) class from a function that processes one line at a time. */
function streamTransform(transformFunction) {
    return class extends Stream.Transform {
        _transform(chunk, encoding, callback) {
            try {
                callback(null, chunkProcessorGenerator(transformFunction)(chunk.toString()));
            }
            catch (err) {
                callback(err);
            }
        }
    };
}
/**
 * Generates a chunk processor function from a function that processes one line at a time but with indented : instead of applying the transform.
 * Does not work correctly.
 * */
function indentChunkProcessorGenerator(processor) {
    return (line, index) => (line.match(/^\[\w\]/) || index == 0 ? processor(line) : `:          ${line}`);
}
const LoggerHighlightTransform = streamTransform(indentChunkProcessorGenerator(formatLine));
class PrependTextTransform extends Stream.Transform {
    constructor(getText, opts) {
        super(opts);
        this.getText = getText;
    }
    _transform(chunk, encoding, callback) {
        callback(null, chunkProcessorGenerator((line) => `${this.getText()} ${line}`)(chunk.toString()));
    }
}
/**Removes a word from logs. Useful to hide your Windows username.*/
class CensorKeywordTransform extends Stream.Transform {
    constructor(keyword, replace, opts) {
        super(opts);
        this.keyword = keyword;
        this.replace = replace;
    }
    _transform(chunk, encoding, callback) {
        callback(null, chunk.toString().replaceAll(this.keyword, this.replace));
    }
}
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans);
    }));
}
async function askYesOrNo(query) {
    let response = await askQuestion(query);
    return response == "y" || response == "yes";
}
const pathSeparator = process.platform == "win32" ? "\\" : "/";
let parsedArgs;
let mindustryArgs;
let settings;
let mindustryProcess;
let currentLogStream;
function parseArgs(args) {
    //Parses arguments into a useable format.
    let parsedArgs = {};
    let argName = "null";
    let mindustryArgs = [];
    let mode = 0;
    for (let arg of args) {
        if (arg == "--") {
            //The remaining args need to be sent to the JVM.
            mode = 1;
            continue;
        }
        if (mode == 1) {
            mindustryArgs.push(arg);
        }
        if (arg.startsWith("--")) {
            argName = arg.slice(2);
            parsedArgs[arg.toLowerCase().slice(2)] = "null";
        }
        else if (argName) {
            parsedArgs[argName] = arg.toLowerCase();
            argName = "null";
        }
    }
    return [parsedArgs, mindustryArgs];
}
function startProcess(_filePath, _jvmArgs, _mindustryArgs) {
    copyMods();
    const proc = spawn("java", _jvmArgs.concat(_mindustryArgs).concat([`-jar ${_filePath}`]).concat(settings.processArgs).join(" ").split(" "));
    const d = new Date();
    if (settings.logging.enabled) {
        currentLogStream = fs.createWriteStream(`${settings.logging.path}${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}--${d.getHours()}-${d.getMinutes()}-${d.getSeconds()}.txt`);
        //Creates a write stream and pipes the output of the mindustry process into it.
        if (settings.logging.removeUsername)
            proc.stdout
                .pipe(new PrependTextTransform(() => getTimeComponent(false)))
                .pipe(new CensorKeywordTransform(process.env["USERNAME"], "[USERNAME]"))
                .pipe(currentLogStream);
        else
            proc.stdout
                .pipe(new PrependTextTransform(() => getTimeComponent(false)))
                .pipe(currentLogStream);
    }
    if (settings.logging.removeUsername) {
        proc.stdout
            .pipe(new LoggerHighlightTransform())
            .pipe(new CensorKeywordTransform(process.env["USERNAME"], "[USERNAME]"))
            .pipe(process.stdout);
        proc.stderr
            .pipe(new LoggerHighlightTransform())
            .pipe(new CensorKeywordTransform(process.env["USERNAME"], "[USERNAME]"))
            .pipe(process.stderr);
    }
    else {
        proc.stdout
            .pipe(new LoggerHighlightTransform())
            .pipe(process.stdout);
        proc.stderr
            .pipe(new LoggerHighlightTransform())
            .pipe(process.stderr);
    }
    return proc;
}
function restart(_filePath, _jvmArgs) {
    log("Restarting!");
    mindustryProcess.removeAllListeners();
    mindustryProcess.kill("SIGTERM"); //todo see if this causes issues
    mindustryProcess = startProcess(_filePath, _jvmArgs, mindustryArgs);
    log("Started new process.");
}
function copyMods() {
    for (let file of settings.externalMods) {
        if (!fs.existsSync(file)) {
            error(`Mod "${file}" does not exist.`);
            continue;
        }
        if (fs.lstatSync(file).isDirectory()) {
            if (fs.existsSync(path.join(file, "build.gradle"))) {
                log(`Copying ${("buildmods" in parsedArgs) ? "and building " : ""}java mod directory "${file}"`);
                if (("buildmods" in parsedArgs)) {
                    try {
                        execSync("gradlew jar", {
                            cwd: file
                        });
                    }
                    catch (err) {
                        throw `Build failed!`;
                    }
                }
                let modFile = fs.readdirSync(path.join(file, "build", "libs"))[0];
                let modName = modFile.match(/[^/\\:*?"<>]+?(?=(Desktop?\.jar$))/i)?.[0];
                fs.copyFileSync(path.join(file, "build", "libs", modFile), path.join(process.env["appdata"], "Mindustry", "mods", modName + ".jar"));
            }
            else {
                log(`Copying mod directory "${file}"`);
                copyDirectory(file, `${process.env["appdata"]}\\Mindustry\\mods\\${file.split(/[\/\\]/).at(-1)}`);
            }
        }
        else {
            log(`Copying modfile "${file}"`);
            let modname = file.match(/(?<=[/\\])[^/\\:*?"<>]+?(?=(Desktop)?\.(jar)|(zip)$)/i); //hello regex my old friend
            if (modname == null)
                error(`Invalid mod filename ${file}!`);
            else
                fs.copyFileSync(file, `${process.env["appdata"]}\\Mindustry\\mods\\${modname[0]}.jar`);
        }
    }
}
function copyDirectory(source, destination) {
    fs.mkdirSync(destination, { recursive: true });
    fs.readdirSync(source, { withFileTypes: true }).forEach(entry => {
        let sourcePath = path.join(source, entry.name);
        let destinationPath = path.join(destination, entry.name);
        entry.isDirectory() ? copyDirectory(sourcePath, destinationPath) : fs.copyFileSync(sourcePath, destinationPath);
    });
}
function parseJSONC(data) {
    return JSON.parse(data.split("\n")
        .filter(line => !/^[ \t]*\/\//.test(line))
        //Removes lines that start with any amount of whitespaces or tabs and two forward slashes(comments).
        .map(line => line.replace(/\*.*?\*/g, ""))
        //Removes "multiline" comments.
        .join("\n"));
}
function downloadFile(version) {
    return new Promise((resolve, reject) => {
        https.get(`https://github.com/Anuken/Mindustry/releases/download/${version}/Mindustry.jar`, (res) => {
            if (res.statusCode != 302) {
                if (res.statusCode == 404) {
                    return reject("The specified version was not found.");
                }
                return reject("Expected status 302, got " + res.statusCode);
            }
            if (!res.headers.location)
                return reject("Redirect location not given");
            https.get(res.headers.location, (res) => {
                const file = fs.createWriteStream(`${settings.mindustryJars.folderPath}${pathSeparator}${version}.jar`);
                res.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve("File downloaded!");
                });
            });
        });
    });
}
async function handleDownload(version) {
    if (await askYesOrNo("Would you like to download the file? [y/n]")) {
        try {
            log("Downloading...");
            log("There's no status bar so you just have to trust me.");
            await downloadFile("v" + version);
            log("Done!");
            launch(path.join(settings.mindustryJars.folderPath, version), true);
        }
        catch (err) {
            error("An error occured while downloading the file: ");
            error(err);
        }
        return;
    }
}
function launch(filePath, recursive) {
    try {
        fs.accessSync(filePath, fs.constants.R_OK);
    }
    catch (err) {
        error(`Unable to access file "${filePath}".`);
        if (recursive) {
            error("Wait what? I just downloaded that.");
            error("Please contact BalaM314 by filing an issue on Github.");
        }
        else {
            error("If you have this version downloaded, check the config.json file to see if the specified filename is correct.");
            handleDownload(parsedArgs["version"]);
        }
        return;
    }
    log(`Launching Mindustry version ${parsedArgs["version"]}`);
    if (mindustryArgs.length > 0) {
        log(`Arguments: ${mindustryArgs}`);
    }
    mindustryProcess = startProcess(filePath, settings.jvmArgs, mindustryArgs);
    process.stdin.on("data", (data) => {
        switch (data.toString("utf-8").slice(0, -2)) { //Input minus the \r\n at the end.
            case "rs":
            case "restart":
                restart(filePath, settings.jvmArgs);
                break;
            case "?":
            case "help":
                log(`Commands: 'restart', 'help', 'exit'`);
                break;
            case "exit":
            case "e":
                log("Exiting...");
                mindustryProcess.removeAllListeners();
                mindustryProcess.kill("SIGTERM");
                process.exit(0);
            default:
                log("Unknown command.");
                break;
        }
    });
    mindustryProcess.on("exit", (statusCode) => {
        if (statusCode == 0) {
            log("Process exited.");
        }
        else {
            log(`Process crashed with exit code ${statusCode}!`);
        }
        process.exit();
    });
    for (let filepath of settings.externalMods) {
        let file = fs.lstatSync(filepath).isDirectory() ? path.join(filepath, "build", "libs") : filePath;
        fs.watchFile(file, () => {
            log(`File change detected! (${file})`);
            if (settings.restartAutomaticallyOnModUpdate)
                restart(filePath, settings.jvmArgs);
        });
    }
}
function init() {
    process.chdir(process.argv[1].split(pathSeparator).slice(0, -1).join(pathSeparator));
    [parsedArgs, mindustryArgs] = parseArgs(processArgs.slice(2));
    let settings = parseJSONC(fs.readFileSync("config.json", "utf-8"));
    for (let [version, jarName] of Object.entries(settings.mindustryJars.customVersionNames)) {
        if (jarName.includes(" ")) {
            error(`Jar name for version ${version} contains a space.`);
            process.exit(1);
        }
    }
    if (!(fs.existsSync(settings.mindustryJars.folderPath) && fs.lstatSync(settings.mindustryJars.folderPath).isDirectory)) {
        error(`Specified path to put Mindustry jars (${settings.mindustryJars.folderPath}) does not exist or is not a directory.\n`);
        process.exit(1);
    }
    //Use the custom version name, but if it doesnt exist use "v${version}.jar";
    let jarName = settings.mindustryJars.customVersionNames[parsedArgs["version"]] ?? `v${parsedArgs["version"] ?? 135}.jar`;
    //If the jar name has a / or \ in it then use it as an absolute path, otherwise relative to folderPath.
    return [settings, jarName.match(/[/\\]/gi) ? jarName : settings.mindustryJars.folderPath + jarName];
}
function updateLauncher() {
    return new Promise((resolve, reject) => {
        function fatalError(err) {
            reject(`A command failed to complete. stdout:
${err.stdout.toString()}
stderr:
${err.stderr.toString()}`);
        }
        function commitChanges() {
            execSync("git add .");
            execSync(`git commit -m "[MindustryLauncher] Automated commit: update"`);
        }
        function pull() {
            execSync("git pull");
        }
        log("Updating...");
        try {
            execSync(`${process.platform == "win32" ? "where" : "which"} git`);
        }
        catch (err) {
            reject("Unable to update automatically as you do not have Git installed.");
        }
        try {
            pull();
            resolve(0);
        }
        catch (err) {
            let errorMessage = err.stderr.toString();
            let outputMessage = err.stdout.toString();
            if (outputMessage.includes("Merge conflict")) {
                execSync("git merge --abort");
                reject("✨mergeconflict✨\nYou have merge conflicts!!11!1!1\nThe merge has been aborted. Please attempt to pull and resolve conflicts manually.");
            }
            else if (errorMessage.includes("commit your changes")) {
                askYesOrNo(`${ANSIEscape.blue}[Launcher]${ANSIEscape.reset} Failed to update because you have local changes. Would you like to commit them?\nIf you don't know what this means, type yes. [y/n]:`)
                    .then(response => {
                    if (response) {
                        try {
                            commitChanges();
                            pull();
                            resolve(0);
                        }
                        catch (err) {
                            let outputMessage = err.stdout.toString();
                            if (outputMessage.includes("Merge conflict")) {
                                execSync("git merge --abort");
                                reject("✨mergeconflict✨\nYou have merge conflicts!!11!1!1\nThe merge has been aborted. Please attempt to pull and resolve conflicts manually.");
                            }
                            else {
                                fatalError(err);
                            }
                        }
                    }
                    else {
                        resolve(1);
                    }
                });
            }
            else {
                fatalError(err);
            }
        }
    });
}
;
function main(processArgs) {
    //Change working directory to directory the file is in, otherwise it would be wherever you ran the command from
    let filePath;
    [settings, filePath] = init();
    if ("help" in parsedArgs) {
        console.log(`Usage: mindustry [--help] [--version <version>] [--compile] [-- jvmArgs]

	--help\tDisplays this help message and exits.
	--version\tSpecifies the version to use.
	--compile\tCompiles before launching, only works if the version points to a source directory.
	--\t\tTells the launcher to stop parsing args and send remaining arguments to the JVM.`);
        return 0;
    }
    if ("update" in parsedArgs) {
        updateLauncher()
            .then(message => {
            switch (message) {
                case 0:
                    log("Successfully updated.");
                    break;
                case 1:
                    log("Update aborted.");
                    break;
            }
        })
            .catch((err) => {
            error("Update failed due to an error!");
            error(err);
        });
        return 0;
    }
    if ("version" in parsedArgs) {
        if (filePath.match(/[/\\]$/i)) {
            if ("compile" in parsedArgs) {
                try {
                    fs.accessSync(`${filePath}/desktop/build.gradle`);
                }
                catch (err) {
                    error(`Unable to find a build.gradle in ${filePath}/desktop/build.gradle. Are you sure this is a Mindustry source directory?`);
                    return 1;
                }
                log("Compiling...");
                let gradleProcess = spawn(`${filePath}/gradlew.bat`, ["desktop:dist"], {
                    cwd: filePath
                });
                gradleProcess.stdout.pipe(new PrependTextTransform(() => `${ANSIEscape.brightpurple}[Gradle]${ANSIEscape.reset}`)).pipe(process.stdout);
                gradleProcess.stderr.pipe(new PrependTextTransform(() => `${ANSIEscape.brightpurple}[Gradle]${ANSIEscape.reset}`)).pipe(process.stderr);
                gradleProcess.on("exit", (code) => {
                    if (code == 0) {
                        log("Compiled succesfully.");
                        filePath += `desktop${pathSeparator}build${pathSeparator}libs${pathSeparator}Mindustry.jar`;
                        launch(filePath);
                    }
                    else {
                        error("Compiling failed.");
                        process.exit(1);
                    }
                });
            }
            else {
                try {
                    fs.accessSync(`${filePath}/desktop/build/libs/Mindustry.jar`);
                }
                catch (err) {
                    error(`Unable to find a Mindustry.jar in ${filePath}/desktop/build/libs/Mindustry.jar. Are you sure this is a Mindustry source directory? You may need to compile first.`);
                    return 1;
                }
                filePath += `desktop${pathSeparator}build${pathSeparator}libs${pathSeparator}Mindustry.jar`;
                launch(filePath);
            }
        }
        else {
            launch(filePath);
        }
    }
    else {
        log("Please specify a version to launch.");
    }
    return 0;
}
try {
    main(process.argv);
}
catch (err) {
    if (typeof err == "string") {
        error("Exiting due to fatal error.");
    }
    else {
        error("Unhandled runtime error!");
        throw err;
    }
}
