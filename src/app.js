/**
Copyright © <BalaM314>, 2022.
This file is part of MindustryLauncher.
MindustryLauncher is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
MindustryLauncher is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
You should have received a copy of the GNU Lesser General Public License along with MindustryLauncher. If not, see <https://www.gnu.org/licenses/>.

Contains the mindustrylauncher Application.
*/
import * as fs from "fs";
import { promises as fsP } from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { Application } from "cli-app";
import { askQuestion, askYesOrNo, error, fatal, formatFileSize, log, stringifyError, throwIfError } from "./funcs.js";
import { compileDirectory, copyMods, init, launch, Version } from "./mindustrylauncher.js";
export const mindustrylauncher = new Application("mindustrylauncher", "A launcher for Mindustry built with Node and TS.");
mindustrylauncher.command("version", "Displays the version of MindustryLauncher.", (opts, app) => {
    const packagePath = path.join(app.sourceDirectory, "package.json");
    try {
        const fileData = fs.readFileSync(packagePath, "utf-8");
        const packageData = JSON.parse(fileData);
        log(`MindustryLauncher version ${packageData["version"]}`);
    }
    catch (err) {
        if (err?.code == "ENOENT") {
            error("Package.json file does not exist! This is likely caused by an improper or corrupt installation.");
        }
        else if (err instanceof SyntaxError) {
            error("Package.json file is invalid! This is likely caused by an improper or corrupt installation.");
        }
        return 1;
    }
}, false, {}, ["v"]);
mindustrylauncher.command("config", "Opens the launcher's config.json file.", (opts, app) => {
    const state = init(opts, app);
    const settingsPath = path.join(state.launcherDataPath, "config.json");
    try {
        log(`Opening ${settingsPath}`);
        throwIfError(spawnSync("code.cmd", [settingsPath]));
        log(`Editor closed.`);
    }
    catch (err) {
        error(stringifyError(err));
        try {
            throwIfError(spawnSync("notepad", [settingsPath]));
            log(`Editor closed.`);
        }
        catch (err) {
            askQuestion("Please specify the editor to use:")
                .then((editor) => {
                throwIfError(spawnSync(editor, [settingsPath]));
                log(`Editor closed.`);
            })
                .catch((err) => error("Could not open the file: " + err));
            return -1;
        }
    }
    return 0;
}, false, {}, ["c"]);
mindustrylauncher.command("logs", "Opens the logs folder", async (opts, app) => {
    const state = init(opts, app);
    if ("info" in opts.namedArgs) {
        const files = (await fsP.readdir(state.settings.logging.path)).map(filename => path.join(state.settings.logging.path, filename));
        const fileData = await Promise.all(files.map(file => fsP.stat(file)));
        log(`You have ${files.length} log files, taking up a total file size of ${formatFileSize(fileData.reduce((acc, item) => acc + item.size, 0))}`);
    }
    else {
        spawnSync(process.platform == "win32" ? "explorer" : "open", [state.settings.logging.path]);
    }
}, false, {
    namedArgs: {
        info: {
            needsValue: false,
            description: "Shows information about your logs instead of the logs folder."
        }
    }
}, ["l"]);
mindustrylauncher.command("launch", "Launches Mindustry.", async (opts, app) => {
    const state = init(opts, app);
    state.version = await Version.fromInput(opts.namedArgs.version, state);
    if (state.version.isSourceDirectory) {
        if ("compile" in opts.namedArgs) {
            const output = await compileDirectory(state.version.path);
            if (!output)
                return 1;
        }
        if (!state.version.exists()) {
            if ("compile" in opts.namedArgs)
                error(`Unable to find a Mindustry.jar in ${state.version.jarFilePath()}. Are you sure this is a Mindustry source directory?`);
            else
                error(`Unable to find a Mindustry.jar in ${state.version.jarFilePath()}. Are you sure this is a Mindustry source directory? You may need to compile first.`);
            return 1;
        }
        //Jar file exists, all good
    }
    if (!state.version.exists()) {
        error(`Version ${state.version.name()} has not been downloaded.`);
        if (state.version.isCustom) {
            throw new Error(`Logic error: nonexistent custom version not caught in fromInput`);
        }
        if (await askYesOrNo("Would you like to download the file? [y/n]:")) {
            const downloaded = await state.version.download(state);
            if (!downloaded)
                return 1;
            //Download was successful
            if (!state.version.exists())
                fatal(`Downloaded file doesn't exist! Attempted to download version ${opts.namedArgs.version} to ${state.version.jarFilePath()}`);
        }
        else {
            return 1;
        }
    }
    copyMods(state);
    launch(state);
    //copy mods and launch
}, true, {
    namedArgs: {
        version: {
            description: "The version to launch, like 141.3, be-22456, foo-latest, foo-v6-1000, etc",
            required: true,
        },
        compile: {
            description: "Whether or not to compile a version before launching, if it points to a Mindustry source directory.",
            needsValue: false
        },
        buildMods: {
            description: "Whether or not to compile Java mod directories before copying.",
            needsValue: false
        }
    },
    positionalArgs: [],
    aliases: {
        c: "compile",
        v: "version",
        b: "buildMods",
    }
});
