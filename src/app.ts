/* @license
Copyright © <BalaM314>, 2024.
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
import { Application, arg } from "@balam314/cli-app";
import { askYesOrNo, crash, error, formatFileSize, log, stringifyError, throwIfError } from "./funcs.js";
import { compileDirectory, copyMods, init, launch, Version } from "./mindustrylauncher.js";


export const mindustrylauncher = new Application("mindustry", "A launcher for Mindustry built with Node and TS.");

mindustrylauncher.command("version", "Displays the version of MindustryLauncher.").aliases("v").args({}).impl((opts, app) => {
	const packagePath = path.join(app.sourceDirectory, "package.json");
	try {
		const fileData = fs.readFileSync(packagePath, "utf-8");
		const packageData = JSON.parse(fileData) as { version: string };
		log(`MindustryLauncher version ${packageData.version}`);
	} catch(err){
		if(err && (err as NodeJS.ErrnoException).code == "ENOENT"){
			error("Package.json file does not exist! This is likely caused by an improper or corrupt installation.");
		} else if(err instanceof SyntaxError){
			error("Package.json file is invalid! This is likely caused by an improper or corrupt installation.");
		}
		return 1;
	}
});

mindustrylauncher.command("versions", "Opens the versions folder.").aliases("vs").args({
	namedArgs: {
		info: arg().aliases("i").valueless()
			.description("Shows information about your versions instead of opening the versions folder."),
	}
}).impl(async (opts, app) => {
	const state = init(opts, app);
	if(opts.namedArgs.info){
		const jarFiles = (await fsP.readdir(state.settings.mindustryJars.folderPath))
			.filter(filename => filename.startsWith("v") && path.extname(filename) == ".jar");
		//Only show mindustry version jar files
		const fileData = await Promise.all(jarFiles.map(file => fsP.stat(path.join(state.settings.mindustryJars.folderPath, file))));
		log(
`List of installed versions:
${jarFiles.map(f => f.split(".")[0]).join(", ")}
You have ${jarFiles.length} version files, taking up a total file size of ${formatFileSize(fileData.reduce((acc, item) => acc + item.size, 0))}`
		);
	} else {
		log(`Opening versions folder: ${state.settings.mindustryJars.folderPath}\nUse --info to get information about installed versions.`);
		spawnSync(process.platform == "win32" ? "explorer" : "open", [state.settings.mindustryJars.folderPath]);
	}
});

mindustrylauncher.command("mods", "Opens the mods folder.").aliases("m").args({
	namedArgs: {
		info: arg().valueless().aliases("i")
			.description("Shows information about your mods instead of opening the mods folder."),
		disable: arg().aliases("d").optional()
			.description("Force disable a mod by putting .disabled in the file extension."),
	}
}).impl(async (opts, app) => {
	const state = init(opts, app);
	if(opts.namedArgs.info){
		const modData = await fsP.readdir(state.modsDirectory);
		const fileData = await Promise.all(modData.map(file => fsP.stat(path.join(state.modsDirectory, file))));
		log(
`List of installed mods:
${modData.join(", ")}
You have ${modData.length} mod files, taking up a total file size of ${formatFileSize(fileData.reduce((acc, item) => acc + item.size, 0))}`
		);
	} else if(opts.namedArgs.disable){
		const modData = await fsP.readdir(state.modsDirectory);
		const modfile = modData.find(f => f.toLowerCase().includes(opts.namedArgs.disable!));
		if(modfile){
			const modfilePath = path.join(state.modsDirectory, modfile);
			if((await fsP.stat(modfilePath)).isFile()){
				await fsP.rename(modfilePath, modfilePath + ".disabled");
				log(`Disabled mod ${modfile}`);
			} else {
				error(`Cannot disable a directory mod.`);
			}
		}
	} else {
		log(`Opening mods folder: ${state.modsDirectory}\nUse --info to get information about installed mods.`);
		spawnSync(process.platform == "win32" ? "explorer" : "open", [state.modsDirectory]);
	}
});

mindustrylauncher.command("config", "Opens the launcher's config.json file.").aliases("c").args({}).impl((opts, app) => {
	const state = init(opts, app);
	const settingsPath = path.join(state.launcherDataPath, "config.json");
	log(`Opening ${settingsPath}`);
	function openEditor(editor:string):boolean {
		try {
			throwIfError(spawnSync(editor, [settingsPath], { stdio: "inherit" }));
			log(`Editor closed.`);
			return true;
		} catch(err){
			if(!stringifyError(err).includes("ENOENT")) error(stringifyError(err));
			return false;
		}
	}
	log(`Editor closed.`);
	if(process.env["EDITOR"]) openEditor(process.env["EDITOR"]);
	else {
		//try some defaults
		const defaults = ["nvim", "code", "code.cmd", "notepad", "nano", "vim"];
		for(const cmd of defaults){
			if(openEditor(cmd)) return 0;
		}
		error(`Could not find an editor. Please set the EDITOR environment variable and try again.`);
		return 1;
	}
});

mindustrylauncher.command("logs", "Opens the logs folder").aliases("l").args({
	namedArgs: {
		info: arg().valueless().aliases("i")
			.description("Shows information about your logs instead of the logs folder."),
	}
}).impl(async (opts, app) => {
	const state = init(opts, app);
	if(opts.namedArgs.info){
		const files = (await fsP.readdir(state.settings.logging.path))
			.map(filename => path.join(state.settings.logging.path, filename));
		const fileData = await Promise.all(files.map(file => fsP.stat(file)));
		log(
`You have ${files.length} log files, taking up a total file size of ${formatFileSize(fileData.reduce((acc, item) => acc + item.size, 0))}`
		);
	} else {
		spawnSync(process.platform == "win32" ? "explorer" : "open", [state.settings.logging.path]);
	}
});

mindustrylauncher.command("launch", "Launches Mindustry.").default().args({
	namedArgs: {
		version: arg().aliases("v").default("latest")
			.description("The version to launch, like 141.3, be-22456, foo-latest, foo-v6-1000, etc"),
		compile: arg().valueless().aliases("c")
			.description("Whether or not to compile a version before launching, if it points to a Mindustry source directory."),
		buildMods: arg().valueless().aliases("b")
			.description("Whether or not to compile Java mod directories before copying.")
	},
	positionalArgsText: "[-- <jvmArgs>... [-- <mindustryArgs>...]]"
}).impl(async (opts, app) => {
	const state = init(opts, app);

	state.version = await Version.fromInput(opts.namedArgs.version, state);
	
	if(state.version.isSourceDirectory){
		if(opts.namedArgs.compile){
			const output = await compileDirectory(state.version.path);
			if(!output) return 1;
		}
		if(!state.version.exists()){
			if(opts.namedArgs.compile)
				error(`Unable to find a Mindustry.jar in ${state.version.jarFilePath()}. Are you sure this is a Mindustry source directory?`);
			else
				error(`Unable to find a Mindustry.jar in ${state.version.jarFilePath()}. Are you sure this is a Mindustry source directory? You may need to compile first.`);
			return 1;
		}
		//Jar file exists, all good
	}

	if(!state.version.exists()){
		error(`Version ${state.version.name()} has not been downloaded.`);
		if(state.version.isCustom) crash(`Logic error: nonexistent custom version not caught in fromInput`);
		if(await askYesOrNo("Would you like to download the file? [y/n]:")){
			const downloaded = await state.version.download(state);
			if(!downloaded) return 1;
			//Download was successful
			if(!state.version.exists()) crash(`Downloaded file doesn't exist! Attempted to download version ${opts.namedArgs.version} to ${state.version.jarFilePath()}`);
		} else {
			return 1;
		}
	}

	await copyMods(state);
	launch(state);
	//copy mods and launch
});
