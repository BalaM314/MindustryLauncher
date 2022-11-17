/**
Copyright © <BalaM314>, 2022.
This file is part of MindustryLauncher.
MindustryLauncher is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
MindustryLauncher is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
You should have received a copy of the GNU Lesser General Public License along with MindustryLauncher. If not, see <https://www.gnu.org/licenses/>.

Contains the mindustrylauncher Application.
*/

import * as fs from "fs";
import * as path from "path";
import { spawnSync } from "child_process";
import { Application } from "cli-app";
import { askQuestion, error, fatal, log, stringifyError, throwIfError } from "./funcs.js";
import { compileDirectory, copyMods, getJarFilePath, handleDownload, init, launch } from "./mindustrylauncher.js";


export const mindustrylauncher = new Application("mindustrylauncher", "A launcher for Mindustry built with Node and TS.");

mindustrylauncher.command("version", "Displays the version of MindustryLauncher.", (opts, app) => {
	const packagePath = path.join(app.sourceDirectory, "package.json");
	try {
		const fileData = fs.readFileSync(packagePath, "utf-8");
		const packageData = JSON.parse(fileData);
		log(`MindustryLauncher version ${packageData["version"]}`);
	} catch(err:any){
		if(err?.code == "ENOENT"){
			error("Package.json file does not exist! This is likely caused by an improper or corrupt installation.");
		} else if(err instanceof SyntaxError){
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
	} catch(err){
		error(stringifyError(err));
		try {
			throwIfError(spawnSync("notepad", [settingsPath]));
			log(`Editor closed.`);
		} catch(err){
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
});

mindustrylauncher.command("launch", "Launches Mindustry.", async (opts, app) => {
	const state = init(opts, app);
	const { filepath, customVersion } = getJarFilePath(opts.namedArgs.version, state.settings);
	let jarFilePath;
	if(!fs.existsSync(filepath)){
		error(`Unable to access file "${filepath}".`);
		if(customVersion){
			error("Cannot download: custom version specified.");
			return 1;
		}
		const downloaded = await handleDownload(state, opts.namedArgs.version);
		if(!downloaded) return 1;
		//Download was successful
		if(fs.existsSync(filepath)) state.jarFile.path = filepath;
		else fatal(`Downloaded file doesn't exist! Attempted to download version ${opts.namedArgs.version} to ${filepath}`);
	}
	
	if(filepath.match(/[/\\]$/i)){//If the filepath is a directory
		if("compile" in opts.namedArgs){
			const output = await compileDirectory(filepath);
			if(!output) return false;
		}
		state.jarFile.sourceDirectory = filepath;
		state.jarFile.path = path.join(filepath, `desktop/build/libs/Mindustry.jar`);
		try {
			fs.accessSync(state.jarFile.path);
		} catch(err){
			if("compile" in opts.namedArgs)
				error(`Unable to find a Mindustry.jar in ${jarFilePath}. Are you sure this is a Mindustry source directory?`);
			else
				error(`Unable to find a Mindustry.jar in ${jarFilePath}. Are you sure this is a Mindustry source directory? You may need to compile first.`);
			return 1;
		}
		//Jar file exists, all good
	} else {
		//It's just a regular file, we already checked that it exists
		state.jarFile.path = filepath;
	}

	copyMods(state);
	launch(state);
	//copy mods and launch
}, true, {
	namedArgs: {
		version: {
			description: "The version to be launch. Can be a vanilla, foo, or be version, which can specify the version number or \"latest\".",
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
	positionalArgs: [
		
	]
});