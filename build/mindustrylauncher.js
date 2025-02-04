/* @license
Copyright © <BalaM314>, 2024.
This file is part of MindustryLauncher.
MindustryLauncher is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
MindustryLauncher is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
You should have received a copy of the GNU Lesser General Public License along with MindustryLauncher. If not, see <https://www.gnu.org/licenses/>.

Contains functions that are part of the program code.
*/
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsP from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApplicationError, fail } from "@balam314/cli-app";
import { ANSIEscape, CensorKeywordTransform, LoggerHighlightTransform, WindowedMean, copyDirectory, crash, downloadFile, error, formatFileSize, getTimeComponent, log, parseJSONC, prependTextTransform, resolveRedirect, spawnAsync, stringifyError } from "./funcs.js";
function startProcess(state) {
    const proc = spawn("java", [...state.jvmArgs, `-jar`, state.version.jarFilePath(), ...state.mindustryArgs], { shell: false });
    const d = new Date();
    if (state.settings.logging.enabled) {
        state.currentLogStream = fs.createWriteStream(path.join(`${state.settings.logging.path}`, `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}--${d.getHours()}-${d.getMinutes()}-${d.getSeconds()}.txt`));
        //Creates a write stream and pipes the output of the mindustry process into it.
        let temp = proc.stdout;
        if (state.settings.logging.removeUsername && state.username != null)
            temp = proc.stdout.pipe(new CensorKeywordTransform(state.username, "[USERNAME]"));
        if (state.settings.logging.removeUUIDs)
            temp = proc.stdout.pipe(new CensorKeywordTransform(/[a-zA-Z0-9+/]{22}==/g, "[UUID]"));
        temp
            .pipe(new (prependTextTransform(() => getTimeComponent(false))))
            .pipe(state.currentLogStream);
    }
    if (state.settings.logging.removeUsername && state.username != null) {
        [proc.stdout, proc.stderr].forEach(stream => stream
            .pipe(new LoggerHighlightTransform())
            .pipe(new CensorKeywordTransform(state.username, "[USERNAME]"))
            .pipe(process.stdout));
    }
    else {
        [proc.stdout, proc.stderr].forEach(stream => stream
            .pipe(new LoggerHighlightTransform())
            .pipe(process.stdout));
    }
    proc.on("exit", (statusCode) => {
        if (statusCode == 0) {
            log("Process exited.");
        }
        else if (statusCode) {
            log(`Process crashed with exit code ${statusCode}!`);
            process.exitCode = statusCode;
        }
        process.exit();
    });
    return proc;
}
/**Restarts the mindustry process. */
async function restart(state, build, compile) {
    if (build && compile) {
        log("Rebuilding mods, recompiling, and restarting...");
    }
    else if (build) {
        log("Rebuilding mods and restarting...");
    }
    else if (compile) {
        log("Recompiling client...");
    }
    else {
        log("Restarting...");
    }
    state.mindustryProcess?.removeAllListeners();
    state.mindustryProcess?.kill("SIGTERM"); //todo see if this causes issues
    state.mindustryProcess = null;
    state.buildMods = build;
    if (compile) {
        if (state.version.isSourceDirectory) {
            const successful = await compileDirectory(state.version.path);
            if (!successful) {
                error("Build failed.");
                process.exit(1);
            }
        }
        else {
            error("Cannot compile, launched version did not come from a source directory.");
        }
    }
    await copyMods(state);
    state.mindustryProcess = startProcess(state);
    log("Started new process.");
}
export async function copyMods(state) {
    const modTasks = state.externalMods.map(async (mod) => {
        if (mod.type == "java") {
            //Maybe build the directory
            if (state.buildMods) {
                log(`Building and copying java mod directory "${mod.path}"`);
                const preBuildTime = Date.now();
                try {
                    const isWindows = os.platform() == "win32";
                    const gradlePath = isWindows ? `${mod.path}/gradlew.bat` : `${mod.path}/gradlew`;
                    const gradleProcess = spawn(gradlePath, ["jar"], {
                        cwd: mod.path,
                        shell: isWindows,
                    });
                    [gradleProcess.stdout, gradleProcess.stderr].forEach(stream => stream
                        .pipe(new (prependTextTransform(`${ANSIEscape.brightpurple}[Gradle]${ANSIEscape.reset}`)))
                        .pipe(process.stdout));
                    //wait until gradle exits
                    const code = await new Promise(res => gradleProcess.on("exit", res));
                    if (code != 0)
                        throw new Error("non-zero exit code");
                }
                catch (err) {
                    fail(`Build failed!`);
                }
                const timeTaken = Date.now() - preBuildTime;
                log(`Built "${path.basename(mod.path)}" in ${timeTaken.toFixed(0)}ms`);
            }
            else {
                log(`Copying java mod directory "${mod.path}"`);
            }
            const modBuildFolder = path.join(mod.path, "build", "libs");
            const modFileName = (await fsP.readdir(modBuildFolder).catch(async () => {
                //mod build folder doesn't exist
                //Check for build.gradle
                if (!state.buildMods) {
                    const gradleExists = fsP.access(path.join(mod.path, "build.gradle"), fs.constants.R_OK);
                    gradleExists.catch(() => { });
                    await gradleExists.then(() => fail(`Could not read the build folder at ${mod.path}. Please build the mod first by passing "--build".`));
                }
                fail(`Could not read the build folder at ${mod.path}. Are you sure this is a Mindustry java mod directory?`);
            }))
                .find(n => n.endsWith(".jar"));
            if (modFileName) {
                const modFilePath = path.join(mod.path, "build", "libs", modFileName);
                if (!fs.existsSync(modFilePath)) {
                    if (state.buildMods) {
                        error(`Java mod directory "${mod.path}" does not have a mod file in build/libs/, skipping copying. There may be an issue with your mod's build.gradle file.`);
                    }
                    else {
                        error(`Java mod directory "${mod.path}" does not have a mod file in build/libs/, skipping copying. This may be because the mod has not been built yet. Run "gradlew jar" to build the mod, or specify --buildMods.`);
                    }
                }
                else {
                    const modName = modFileName.match(/[^/\\:*?"<>]+?(?=(Desktop?\.jar$))/i)?.[0];
                    await fsP.copyFile(modFilePath, path.join(state.modsDirectory, modName + ".jar"));
                }
            }
        }
        else if (mod.type == "dir") {
            //Copy the whole directory
            log(`Copying mod directory "${mod.path}"`);
            copyDirectory(mod.path, path.join(state.modsDirectory, path.basename(mod.path)), ".git");
        }
        else if (mod.type == "file") {
            //Copy the mod file
            const modname = path.basename(mod.path);
            log(`Copying mod file "${mod.path}"`);
            fs.copyFileSync(mod.path, path.join(state.modsDirectory, modname));
        }
    });
    if (state.settings.buildModsConcurrently)
        await Promise.all(modTasks);
    else
        for (const modTask of modTasks) {
            await modTask;
        }
}
export async function openDirectory(directory) {
    await spawnAsync(process.platform == "win32" ? "explorer" : "xdg-open", [directory], { stdio: "ignore" })
        .catch(e => {
        if (e instanceof Error)
            fail(`Failed to open the directory: ${e.message}`);
        else if (typeof e == "string")
            error(`Process exited with ${e}`);
        else
            throw e;
    });
}
export const versionUrls = {
    foo: {
        url: version => `https://github.com/mindustry-antigrief/mindustry-client-v7-builds/releases/download/${version}/desktop.jar`,
        getLatestVersion: [`https://github.com/mindustry-antigrief/mindustry-client-v7-builds/releases/latest`, /(?<=\/tag\/)(\d+)/],
        prefix: "foo-",
        numberValidator: /^(\d+|latest)$/,
    },
    "foo-v6": {
        url: version => `https://github.com/mindustry-antigrief/mindustry-client-v6-builds/releases/download/${version}/desktop.jar`,
        getLatestVersion: [`https://github.com/mindustry-antigrief/mindustry-client-v6-builds/releases/latest`, /(?<=\/tag\/)(\d+)/],
        prefix: "foo-v6-",
        numberValidator: /^(\d+|latest)$/,
    },
    be: {
        url: version => `https://github.com/Anuken/MindustryBuilds/releases/download/${version}/Mindustry-BE-Desktop-${version}.jar`,
        getLatestVersion: [`https://github.com/Anuken/MindustryBuilds/releases/latest`, /(?<=\/tag\/)(\d+)/],
        prefix: "be-",
        numberValidator: /^(\d+|latest)$/,
    },
    vanilla: {
        url: version => `https://github.com/Anuken/Mindustry/releases/download/v${version}/Mindustry.jar`,
        getLatestVersion: [`https://github.com/Anuken/Mindustry/releases/latest`, /(?<=\/tag\/v)(\d+(?:\.\d)?)/],
        prefix: "",
        numberValidator: /^(\d+(?:\.\d+)?|latest)$/,
    },
};
export class Version {
    constructor(path, isCustom, isSourceDirectory, versionType = null, versionNumber = null) {
        this.path = path;
        this.isCustom = isCustom;
        this.isSourceDirectory = isSourceDirectory;
        this.versionType = versionType;
        this.versionNumber = versionNumber;
    }
    static async fromInput(version, state) {
        let filepath, isCustom = false, isSourceDirectory = false, versionType = null, versionNumber = null;
        if (state.settings.mindustryJars.customVersionNames[version]) {
            isCustom = true;
            filepath = state.settings.mindustryJars.customVersionNames[version];
            if (!fs.existsSync(filepath))
                fail(`Invalid custom version ${version}: specified filepath ${filepath} does not exist.`);
            if (fs.lstatSync(filepath).isDirectory()) {
                try {
                    fs.accessSync(path.join(filepath, "/desktop/build.gradle"));
                }
                catch (err) {
                    fail(`Invalid custom version ${version}: Unable to find a build.gradle in ${filepath}/desktop/build.gradle. Are you sure this is a Mindustry source directory?`);
                }
                isSourceDirectory = true;
            }
        }
        else {
            for (const [name, versionData] of Object.entries(versionUrls)) {
                if (version.startsWith(versionData.prefix)) {
                    const potentialVersionNumber = version.replace(versionData.prefix, "");
                    if (!versionData.numberValidator.test(potentialVersionNumber))
                        continue;
                    versionType = name;
                    versionNumber = potentialVersionNumber;
                }
            }
            if (versionType == null || versionNumber == null)
                fail(`Invalid version ${version}`);
            if (versionNumber == "latest") {
                log(`Getting latest ${versionType} version...`);
                versionNumber = await this.getLatestVersion(versionType);
                log(`Resolved version ${version} to ${versionType}-${versionNumber}`);
            }
            filepath = path.join(state.settings.mindustryJars.folderPath, `v${versionUrls[versionType].prefix}${versionNumber}.jar`);
        }
        return new this(filepath, isCustom, isSourceDirectory, versionType, versionNumber);
    }
    jarFilePath() {
        if (this.isSourceDirectory) {
            return path.join(this.path, Version.builtJarLocation);
        }
        else {
            return this.path;
        }
    }
    exists() {
        return fs.existsSync(this.jarFilePath());
    }
    name() {
        if (this.isSourceDirectory)
            return `[Source directory at ${this.path}]`;
        if (this.isCustom)
            return `[custom version]`;
        if (!this.versionNumber || !this.versionType)
            crash("versionNumber should exist");
        return `${this.versionType}-${this.versionNumber}`;
    }
    async getDownloadUrl() {
        if (this.versionType == null || this.versionNumber == null)
            crash(`Logic error caused by ${this.versionType} at lookupDownloadUrl`);
        const versionData = versionUrls[this.versionType];
        log(`Looking up download url for ${this.versionType} version ${this.versionNumber}`);
        if (this.versionNumber == "latest")
            crash("Logic error: version's number was 'latest'.");
        return {
            url: await resolveRedirect(versionData.url(this.versionNumber)),
            jarName: `v${versionData.prefix}${this.versionNumber}.jar`
        };
    }
    async download(state) {
        try {
            const { url, jarName } = await this.getDownloadUrl();
            const filePath = path.join(state.settings.mindustryJars.folderPath, jarName);
            log("Downloading...");
            console.log("");
            const downloadSpeed = new WindowedMean(25);
            await downloadFile(url, filePath + ".tmp", (downloaded, total) => {
                downloadSpeed.add(downloaded);
                if (process.stdout.columns > 50) {
                    const barWidth = process.stdout.columns - 45;
                    const barProgress = Math.floor(downloaded / total * barWidth);
                    process.stdout.write(`\x1B[1A
  [${"=".repeat(barProgress) + " ".repeat(barWidth - barProgress)}] ${formatFileSize(downloaded).padEnd(10, " ")}/ ${formatFileSize(total).padEnd(10, " ")}(${formatFileSize(downloadSpeed.mean(25, 0))}/s)   `);
                }
            });
            process.stdout.write("\n");
            await fsP.rename(filePath + ".tmp", filePath);
            log(`File downloaded to ${filePath}.`);
            return true;
        }
        catch (err) {
            error("Download failed: " + stringifyError(err));
            return false;
        }
    }
    static async getLatestVersion(name) {
        const versionData = versionUrls[name];
        const resolvedUrl = await resolveRedirect(versionData.getLatestVersion[0]);
        const result = versionData.getLatestVersion[1].exec(resolvedUrl);
        return result?.[1] ?? crash(`regex /${versionData.getLatestVersion[1].source}/ did not match resolved url ${resolvedUrl} for version ${name}`);
    }
}
Version.builtJarLocation = "desktop/build/libs/Mindustry.jar";
export async function compileDirectory(path) {
    try {
        fs.accessSync(`${path}/desktop/build.gradle`);
    }
    catch (err) {
        error(`Unable to find a build.gradle in ${path}/desktop/build.gradle. Are you sure this is a Mindustry source directory?`);
        return false;
    }
    log("Compiling...");
    const isWindows = os.platform() == "win32";
    const gradlePath = isWindows ? `${path}/gradlew.bat` : `${path}/gradlew`;
    const gradleProcess = spawn(gradlePath, ["desktop:dist"], {
        cwd: path,
        shell: isWindows,
    });
    [gradleProcess.stdout, gradleProcess.stderr].forEach(stream => stream
        .pipe(new (prependTextTransform(`${ANSIEscape.brightpurple}[Gradle]${ANSIEscape.reset}`)))
        .pipe(process.stdout));
    //wait until gradle exits
    const code = await new Promise(res => gradleProcess.on("exit", res));
    if (code == 0) {
        log("Compiled succesfully.");
        return true;
    }
    else {
        log("Compiling failed.");
        return false;
    }
}
export function launch(state) {
    log(`Launching Mindustry version ${state.versionName}`);
    if (state.mindustryArgs.length > 0) {
        log(`Arguments for Mindustry: ${state.mindustryArgs.join(", ")}`);
    }
    state.mindustryProcess = startProcess(state);
    //Apply command handler
    process.stdin.on("data", data => handleCommand(data.toString().replace(/\r?\n$/, ""), state));
    //Apply more handlers
    if (state.settings.restartAutomaticallyOnModUpdate) {
        for (const mod of state.externalMods) {
            if (mod.type == "file")
                fs.watchFile(mod.path, () => {
                    log(`File change detected! (${mod.path})`);
                    void restart(state, true, false);
                });
            else if (mod.type == "dir")
                fs.watchFile(mod.path, () => {
                    log(`File change detected! (${mod.path})`);
                    void restart(state, true, false);
                });
            else if (mod.type == "java")
                fs.watchFile(state.settings.watchWholeJavaModDirectory ? mod.path : path.join(mod.path, "build/libs"), () => {
                    log(`File change detected! (${mod.path})`);
                    void restart(state, true, false);
                });
        }
    }
}
export function handleCommand(input, state) {
    switch (input.split(" ")[0].toLowerCase()) {
        case "rs":
        case "restart":
            void restart(state, false, false);
            break;
        case "rb":
        case "rebuild":
            void restart(state, true, false);
            break;
        case "rc":
        case "recompile":
            void restart(state, false, true);
            break;
        case "?":
        case "h":
        case "help":
            log(`Commands: 'restart/rs', 'rebuild/rb', 'recompile/rc', 'help/h/?', 'exit/e/quit/q'`);
            break;
        case "exit":
        case "e":
        case "q":
        case "quit":
            log("Exiting...");
            state.mindustryProcess?.removeAllListeners();
            state.mindustryProcess?.kill("SIGTERM");
            process.exit(0);
            break;
        case "pass":
        case "-":
        case "p":
            if (state.mindustryProcess?.stdin?.writable) {
                state.mindustryProcess.stdin.write(input.split(" ").slice(1).join(" ") + "\r\n");
            }
            else {
                log("Error: Stream not writeable.");
            }
            break;
        default:
            log("Unknown command.");
            break;
    }
}
function validateSettings(input, username) {
    try {
        const settings = input;
        if (!(input instanceof Object))
            fail("settings is not an object");
        if (!fs.existsSync(settings.mindustryJars.folderPath))
            fail(`Specified path to put Mindustry jars (${settings.mindustryJars.folderPath}) does not exist.`);
        if (!fs.lstatSync(settings.mindustryJars.folderPath).isDirectory())
            fail(`Specified path to put Mindustry jars (${settings.mindustryJars.folderPath}) is not a directory.`);
        for (const [version, jarName] of Object.entries(settings.mindustryJars.customVersionNames)) {
            if (jarName.includes(" "))
                fail(`Jar name for version ${version} contains a space.`);
        }
        if (settings.logging.enabled) {
            if (!fs.existsSync(settings.logging.path))
                fail(`Logging path (${settings.logging.path}) does not exist.`);
            if (!fs.lstatSync(settings.logging.path).isDirectory())
                fail(`Logging path (${settings.logging.path}) is not a directory.`);
        }
        if (username == null && settings.logging.removeUsername) {
            error("Could not determine your username, disabling logging.removeUsername");
            settings.logging.removeUsername = false;
        }
    }
    catch (err) {
        if (err instanceof ApplicationError) {
            fail(`Invalid settings: ${err.message}\nRun "mindustry config" to edit the settings file.`);
        }
        else {
            error("The following crash was possibly caused by an invalid settings file, try renaming it to automatically create a new one...");
            throw err;
        }
    }
}
/**Returns a State given process args. */
export function init(opts, app) {
    //Change working directory to the same as this program's index.js file
    process.chdir(app.sourceDirectory);
    //Get a bunch of static things
    const mindustryDirectory = process.platform == "win32" ? path.join(process.env["APPDATA"], "Mindustry/") :
        process.platform == "darwin" ? path.join(os.homedir(), "/Library/Application Support/Mindustry/") :
            process.platform == "linux" ? path.normalize((process.env["XDG_DATA_HOME"] ?? path.join(os.homedir(), "/.local/share")) + "/Mindustry/") :
                fail(`Unsupported platform ${process.platform}`);
    const modsDirectory = path.join(mindustryDirectory, "mods");
    const launcherDataPath = path.join(mindustryDirectory, "launcher");
    const username = process.env["USERNAME"] ?? process.env["USER"] ?? null;
    //if settings file doesn't exist, 
    if (!fs.existsSync(path.join(launcherDataPath, "config.json"))) {
        log("No config.json file found, creating one. If this is your first launch, this is fine.");
        if (!fs.existsSync(launcherDataPath)) {
            fs.mkdirSync(launcherDataPath, {
                recursive: true
            });
        }
        const versionsPath = path.join(mindustryDirectory, "versions");
        const templateConfig = fs.readFileSync("template-config.json", "utf-8")
            .replace("{{VERSIONSDIR}}", JSON.stringify(versionsPath))
            .replace(/\r?\n/g, os.EOL);
        fs.mkdirSync(versionsPath, { recursive: true });
        fs.writeFileSync(path.join(launcherDataPath, "config.json"), templateConfig);
        if (opts.commandName != "config")
            log("Currently using default settings: run `mindustry config` to edit the settings file.");
    }
    const settings = parseJSONC(fs.readFileSync(path.join(launcherDataPath, "config.json"), "utf-8"));
    if (opts.commandName != "config")
        validateSettings(settings, username);
    const externalMods = settings.externalMods.map(modPath => ({
        path: modPath,
        type: fs.existsSync(modPath) ?
            fs.lstatSync(modPath).isDirectory() ?
                fs.existsSync(path.join(modPath, "build.gradle")) ? "java" : "dir"
                : "file"
            : (error(`External mod "${modPath}" does not exist.`), "invalid")
    }));
    let mindustryArgs;
    let jvmArgs = [];
    if (opts.positionalArgs.includes("--")) {
        jvmArgs = opts.positionalArgs.slice(opts.positionalArgs.indexOf("--") + 1, opts.positionalArgs.lastIndexOf("--"));
        mindustryArgs = opts.positionalArgs.slice(opts.positionalArgs.lastIndexOf("--") + 1);
    }
    else {
        mindustryArgs = opts.positionalArgs;
    }
    return {
        settings,
        currentLogStream: null,
        launcherDataPath,
        mindustryDirectory,
        mindustryProcess: null,
        modsDirectory,
        username,
        versionName: opts.namedArgs.version ?? null, //TODO fix this mess
        mindustryArgs: settings.processArgs.concat(mindustryArgs),
        jvmArgs: settings.jvmArgs.concat(jvmArgs),
        externalMods,
        buildMods: opts.namedArgs.buildMods ?? false,
        version: null //TODO this is probably bad
    };
}
