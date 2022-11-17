/**
Copyright © <BalaM314>, 2022.
This file is part of MindustryLauncher.
MindustryLauncher is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
MindustryLauncher is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
You should have received a copy of the GNU Lesser General Public License along with MindustryLauncher. If not, see <https://www.gnu.org/licenses/>.

Contains functions that are part of the program code.
*/



import * as path from "path";
import * as fs from "fs";
import * as https from "https";
import * as os from "os";
import { spawn, execSync } from "child_process";
import { Application, Options } from "cli-app";
import {
	prependTextTransform, getTimeComponent, CensorKeywordTransform, LoggerHighlightTransform,
	log, error, fatal, copyDirectory, askYesOrNo, downloadFile, parseJSONC,
	ANSIEscape, resolveRedirect, stringifyError
} from "./funcs.js";
import { State, Settings } from "./types.js";




function startProcess(state:State){
	const proc = spawn(
		"java",
		[...state.jvmArgs, `-jar`, state.jarFile.path, ...state.mindustryArgs],
		{ shell: false }
	);
	const d = new Date();

	if(state.settings.logging.enabled){
		state.currentLogStream = fs.createWriteStream(
			path.join(`${state.settings.logging.path}`, `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}--${d.getHours()}-${d.getMinutes()}-${d.getSeconds()}.txt`)
		);
		//Creates a write stream and pipes the output of the mindustry process into it.
		if(state.settings.logging.removeUsername && state.username != null)
			proc.stdout
				.pipe(new (prependTextTransform(() => getTimeComponent(false))))
				.pipe(new CensorKeywordTransform(state.username, "[USERNAME]"))
				.pipe(state.currentLogStream);
		else
			proc.stdout
				.pipe(new (prependTextTransform(() => getTimeComponent(false))))
				.pipe(state.currentLogStream);
	}
	if(state.settings.logging.removeUsername && state.username != null){
		proc.stdout
			.pipe(new LoggerHighlightTransform())
			.pipe(new CensorKeywordTransform(state.username, "[USERNAME]"))
			.pipe(process.stdout);
		proc.stderr
			.pipe(new LoggerHighlightTransform())
			.pipe(new CensorKeywordTransform(state.username, "[USERNAME]"))
			.pipe(process.stderr);
	} else {
		proc.stdout
			.pipe(new LoggerHighlightTransform())
			.pipe(process.stdout);
		proc.stderr
			.pipe(new LoggerHighlightTransform())
			.pipe(process.stderr);
	}

	proc.on("exit", (statusCode) => {
		if(statusCode == 0){
			log("Process exited.");
		} else {
			log(`Process crashed with exit code ${statusCode}!`);
		}
		process.exit();
	});
	
	return proc;
}

/**Restarts the mindustry process. */
async function restart(state:State, build:boolean, compile:boolean){
	if(build && compile){
		error("How were you able to trigger a rebuild and a recompile at the same time? Restarting...");
	} else if(build){
		log("Rebuilding mods and restarting...");
	} else if(compile){
		log("Recompiling client...");
	} else {
		log("Restarting...");
	}
	state.mindustryProcess?.removeAllListeners();
	state.mindustryProcess?.kill("SIGTERM");//todo see if this causes issues
	state.buildMods = build;
	copyMods(state);
	if(compile){
		if(state.jarFile.sourceDirectory){
			await compileDirectory(state.jarFile.sourceDirectory);
		} else {
			error("Cannot compile, launched version did not come from a source directory.");
		}
	}
	state.mindustryProcess = startProcess(state);
	log("Started new process.");
}

export async function copyMods(state:State){
	for(const mod of state.externalMods){
		if(mod.type == "java"){
			//Maybe build the directory
			if(state.buildMods){
				log(`Building and copying java mod directory "${mod.path}"`);
				const preBuildTime = Date.now();
				try {
					execSync("gradlew jar", {
						cwd: mod.path
					});
				} catch(err){
					fatal(`Build failed!`);
				}
				const timeTaken = Date.now() - preBuildTime;
				log(`Built "${path.basename(mod.path)}" in ${timeTaken.toFixed(0)}ms`);
			} else {
				log(`Copying java mod directory "${mod.path}"`);
			}
			
			const modFileName = fs.readdirSync(path.join(mod.path, "build", "libs")).filter(n => n.endsWith(".jar"))[0];
			const modFilePath = path.join(mod.path, "build", "libs", modFileName);
			if(!fs.existsSync(modFilePath)){
				if(state.buildMods){
					error(`Java mod directory "${mod.path}" does not have a mod file in build/libs/, skipping copying. There may be an issue with your mod's build.gradle file.`);
				} else {
					error(`Java mod directory "${mod.path}" does not have a mod file in build/libs/, skipping copying. This may be because the mod has not been built yet. Run "gradlew jar" to build the mod, or specify --buildMods.`);
				}
			} else {
				const modName = modFileName.match(/[^/\\:*?"<>]+?(?=(Desktop?\.jar$))/i)?.[0];
				fs.copyFileSync(
					modFilePath,
					path.join(state.modsDirectory, modName + ".jar")
				);
			}

		} else if(mod.type == "dir"){
			//Copy the whole directory
			log(`Copying mod directory "${mod.path}"`);
			copyDirectory(mod.path, path.join(state.modsDirectory, path.basename(mod.path)), ".git");
		} else if(mod.type == "file"){
			//Copy the mod file
			let modname = path.basename(mod.path).split(".").slice(0, -1).join(".");
			if(modname == "") modname = path.basename(mod.path);
			log(`Copying modfile "${mod.path}"`);
			fs.copyFileSync(mod.path, path.join(state.modsDirectory, modname[0] + path.extname(mod.path)));
		}
	}
}

export const versionUrls: {
	[type:string]: {
		/**Returns url to .jar file given version number. */
		url: (version:string) => string;
		/**Contains data used to get the latest version: $[0] is a redirect to resolve, and $[1] is a regex that returns the version number from the resolved redirect in the first capture group. */
		getLatestVersion: [string, RegExp];
		/**Regex matching the provided version. First capture group should return the version number, or "latest". */
		regex: RegExp;
	};
} = {
	vanilla: {
		url: version => `https://github.com/Anuken/Mindustry/releases/download/v${version}/Mindustry.jar`,
		getLatestVersion: [`https://github.com/Anuken/Mindustry/releases/latest`, /(?<=\/tag\/v)(\d+(?:\.\d)?)/],
		regex: /^(\d+(?:\.\d)?|latest)$/
	},
	foo: {
		url: version => `https://github.com/mindustry-antigrief/mindustry-client-v7-builds/releases/download/${version}/desktop.jar`,
		getLatestVersion: [`https://github.com/mindustry-antigrief/mindustry-client-v7-builds/releases/latest`, /(?<=\/tag\/)\d+/],
		regex: /(?<=^foo-)(\d+|latest)$/i
	},
	"foo-v6": {
		url: version => `https://github.com/mindustry-antigrief/mindustry-client-v6-builds/releases/download/${version}/desktop.jar`,
		getLatestVersion: [`https://github.com/mindustry-antigrief/mindustry-client-v6-builds/releases/latest`, /(?<=\/tag\/)\d+/],
		regex: /(?<=^foo-v6-)(\d+|latest)$/i
	},
	be: {
		url: version => `https://github.com/Anuken/MindustryBuilds/releases/download/${version}/Mindustry-BE-Desktop-${version}.jar`,
		getLatestVersion: [`https://github.com/Anuken/MindustryBuilds/releases/latest`, /(?<=\/tag\/)\d+/],
		regex: /(?<=be-)(\d+|latest)$/i
	},
};

/**Returns the name of a version from input. */
export function getVersion(input:string):string | null {
	Object.entries(versionUrls).forEach(([name, versionData]) => {
		if(versionData.regex.test(input)) return name;
	});
	return null;
}

export function getJarFilePath(version:string, settings:Settings):{
	filepath: string, customVersion: boolean
} {
	const customVersion = settings.mindustryJars.customVersionNames[version];
	//Use the custom version name if it exists, otherwise "v${version}.jar";
	const jarPath = customVersion ?? `v${version}.jar`;
	//If the jar name has a / or \ in it then use it as an absolute path, otherwise relative to folderPath.
	return {
		filepath: (jarPath
			.match(/[/\\]/gi) ? jarPath : path.join(settings.mindustryJars.folderPath, jarPath))
			.replace(/%[^ %]+?%/g, (text:string) => process.env[text.split("%")[1]] ?? text),
		customVersion: customVersion != undefined
	};
}

export async function getLatestVersion(name:string):Promise<string> {
	const versionData = versionUrls[name];
	const resolvedUrl = await resolveRedirect(versionData.getLatestVersion[0]);
	const result = versionData.getLatestVersion[1].exec(resolvedUrl);
	if(result == null || result[1] == undefined)
		throw new Error(`regex /${versionData.regex.source}/ did not match resolved url ${resolvedUrl} for version ${name}`);
	return result[1];
}

export function lookupDownloadUrl(version:string, versionName:string){
	return new Promise<{
		url: string; jarName: string;
	}>((resolve, reject) => {
		const versionData = versionUrls[versionName];
		if(versionData.regex.test(version)){
			const result = version.match(versionData.regex);
			if(result == null || result[1] == undefined)
				throw new Error(`versionUrls ast for version ${versionName} is invalid; regex /${versionData.regex.source}/ matched ${version} but didn't have a capture group`);
			log(`Looking up download url for ${versionName} version ${result[1]}`);
			if(result[1] == "latest"){
				resolveRedirect(versionData.getLatestVersion[0])
					.then(resolvedUrl => {
						const result = versionData.getLatestVersion[1].exec(resolvedUrl);
						if(result == null || result[1] == undefined)
							throw new Error(`versionUrls ast for version ${versionName} is invalid; regex /${versionData.regex.source}/ matched ${version} but didn't have a capture group`);
						log(`Looking up download url for ${versionName} version ${result[1]}`);
						resolveRedirect(versionData.url(result[1]))
							.then((url) => resolve({
								url, jarName: versionName + "-" + result[1]
							})).catch(reject);
					});
			} else {
				resolveRedirect(versionData.url(result[1]))
					.then((url) => resolve({
						url, jarName: versionName + "-" + result[1]
					})).catch(reject);
			}
		} else {
			reject(`Invalid version ${version}`);
		}
	});
}

export function ___getPathOfVersion(version:string):Promise<string> {
	return new Promise((resolve, reject) => {
		if(version.match(/^\d+\.?\d?$/)){
			//Regular mindustry version
			resolveRedirect(`https://github.com/Anuken/Mindustry/releases/download/v${version}/Mindustry.jar`)
				.then(response => resolve(response))
				.catch(error => reject(error));
		} else if(version.match(/(?<=^foo-)\d+$/i)){
			//Foo version
			const versionNumber = version.match(/(?<=^foo-)\d+$/i)![0]!;
			resolveRedirect(`https://github.com/mindustry-antigrief/mindustry-client-v7-builds/releases/download/${versionNumber}/desktop.jar`)
				.then(response => resolve(response))
				.catch(error => reject(error));
		} else if(version.match(/(?<=be-)\d+$/i)){
			//Bleeding edge version
			const versionNumber = version.match(/(?<=be-)\d+$/i)![0]!;
			resolveRedirect(`https://github.com/Anuken/MindustryBuilds/releases/download/${versionNumber}/Mindustry-BE-Desktop-${versionNumber}.jar`)
				.then(response => resolve(response))
				.catch(error => reject(error));
		} else if(version == "foo"){
			https.get(`https://github.com/mindustry-antigrief/mindustry-client-v7-builds/releases/latest`, (res) => {
				if(res.statusCode != 302){
					reject(`Error: Expected status 302, got ${res.statusCode}`);
				}
				if(res.headers.location){
					const versionNumber = res.headers.location.match(/(?<=\/tag\/)\d+/)?.[0];
					if(!versionNumber){
						reject(`Error: Server responded with invalid redirect location.`);
					}
					resolveRedirect(`https://github.com/mindustry-antigrief/mindustry-client-v7-builds/releases/download/${versionNumber}/desktop.jar`)
						.then(response => resolve(response))
						.catch(error => reject(error));
				} else {
					reject(`Error: Server did not respond with redirect location.`);
				}
			});
		} else if(version == "be"){
			https.get(`https://github.com/Anuken/MindustryBuilds/releases/latest`, (res) => {
				if(res.statusCode != 302){
					reject(`Error: Expected status 302, got ${res.statusCode}`);
				}
				if(res.headers.location){
					const versionNumber = res.headers.location.match(/(?<=\/tag\/)\d+/)?.[0];
					if(!versionNumber){
						reject(`Error: Server responded with invalid redirect location.`);
					}
					resolveRedirect(`https://github.com/Anuken/MindustryBuilds/releases/download/${versionNumber}/Mindustry-BE-Desktop-${versionNumber}.jar`)
						.then(response => resolve(response))
						.catch(error => reject(error));
				} else {
					reject(`Error: Server did not respond with redirect location.`);
				}
			});
		}
	});
}

export async function handleDownload(state:State, specifiedVersion:string):Promise<boolean> {
	const versionName = getVersion(specifiedVersion);
	if(versionName == null){
		error("Cannot download: unknown version.");
		return false;
	}
	if(await askYesOrNo("Would you like to download the file? [y/n]:")){
		try {
			const {
				url, jarName
			} = await lookupDownloadUrl(specifiedVersion, versionName);
			const filePath = path.join(state.settings.mindustryJars.folderPath, jarName);
			//TODO change filepath if version is latest
			log("Downloading...");
			await downloadFile(url, filePath);
			log(`File downloaded to ${filePath}.`);
			return true;
		} catch(err){
			error("Download failed: " + stringifyError(err));
			return false;
		}
	} else return false;
}


export async function compileDirectory(path:string):Promise<boolean> {
	try {
		fs.accessSync(`${path}/desktop/build.gradle`);
	} catch(err){
		error(`Unable to find a build.gradle in ${path}/desktop/build.gradle. Are you sure this is a Mindustry source directory?`);
		return false;
	}
	log("Compiling...");
	const gradleProcess = spawn(`${path}/gradlew.bat`, ["desktop:dist"], {
		cwd: path
	});
	gradleProcess.stdout
		.pipe(new (prependTextTransform(`${ANSIEscape.brightpurple}[Gradle]${ANSIEscape.reset}`)))
		.pipe(process.stdout);
	gradleProcess.stderr
		.pipe(new (prependTextTransform(`${ANSIEscape.brightpurple}[Gradle]${ANSIEscape.reset}`)))
		.pipe(process.stderr);
	//Fancy promise stuff, wait until gradle exits
	const code = await new Promise<number>(res => gradleProcess.on("exit", res));
	if(code == 0){
		log("Compiled succesfully.");
		return true;
	} else {
		log("Compiling failed.");
		return false;
	}
}

export function launch(state:State){
	
	log(`Launching Mindustry version ${state.namedArgs["version"]}`);
	if(state.mindustryArgs.length > 0){
		log(`Arguments: ${state.mindustryArgs}`);
	}

	state.mindustryProcess = startProcess(state);

	//Apply handlers TODO refactor out
	process.stdin.on("data", (data) => {
		switch(data.toString("utf-8").slice(0, -2)){//Input minus the \r\n at the end.
			case "rs": case "restart":
				restart(state, false, false);
				break;
			case "rb": case "rebuild":
				restart(state, true, false);
				break;
			case "rc": case "recompile":
				restart(state, false, true);
				break;
			case "?": case "help":
				log(`Commands: 'restart/rs', 'rebuild/rb', 'recompile/rc', 'help', 'exit'`);
				break;
			case "exit": case "e":
				log("Exiting...");
				state.mindustryProcess?.removeAllListeners();
				state.mindustryProcess?.kill("SIGTERM");
				process.exit(0);
				break;
			default:
				log("Unknown command.");
				break;
		}
	});


	//Apply more handlers
	if(state.settings.restartAutomaticallyOnModUpdate){
		for(const mod of state.externalMods){
			//let file = fs.lstatSync(filepath).isDirectory() ? path.join(filepath, "build", "libs") : filepath;
			//TODO this handling seems wrong
			if(mod.type == "file")
				fs.watchFile(mod.path, () => {
					log(`File change detected! (${mod.path})`);
					restart(state, true, false);
				});
			else if(mod.type == "dir")
				fs.watchFile(mod.path, () => {
					log(`File change detected! (${mod.path})`);
					restart(state, true, false);
				});
			else if(mod.type == "java")
				fs.watchFile(state.settings.watchWholeJavaModDirectory ? mod.path : path.join(mod.path, "build/libs"), () => {
					log(`File change detected! (${mod.path})`);
					restart(state, true, false);
				});
		}
	}

}

function validateSettings(input:any, username:string | null):asserts input is Settings {
	if(!(input instanceof Object)) throw new Error("settings is not an object");
	const settings = input as Settings;
	try {
		for(const [version, jarName] of Object.entries(settings.mindustryJars.customVersionNames)){
			if(jarName.includes(" ")){
				error(`Jar name for version ${version} contains a space.`);
				error(`Run "mindustry --config" to change settings.`);
				process.exit(1);
			}
		}

		if(username == null && settings.logging.removeUsername){
			error("Could not determine your username, disabling logging.removeUsername");
			settings.logging.removeUsername = false;
		}

		if(!(fs.existsSync(settings.mindustryJars.folderPath) && fs.lstatSync(settings.mindustryJars.folderPath).isDirectory())){
			error(`Specified path to put Mindustry jars (${settings.mindustryJars.folderPath}) does not exist or is not a directory.\n`);
			error(`Run "mindustry --config" to change settings.`);
			process.exit(1);
		}
	} catch(err:any){
		throw new Error("Invalid settings: " + err.message);
	}
}

/**Returns a State given process args. */
export function init(opts:Options, app:Application):State {
	//Change working directory to the same as this program's index.js file
	process.chdir(app.sourceDirectory);

	//Get a bunch of static things
	const mindustryDirectory =
	process.platform == "win32" ? path.join(process.env["APPDATA"]!, "Mindustry/") :
		process.platform == "darwin" ? path.join(os.homedir(), "/Library/Application Support/Mindustry/") : 
			process.platform == "linux" ? path.normalize((process.env["XDG_DATA_HOME"] ?? path.join(os.homedir(), "/.local/share")) + "/Mindustry/") :
				fatal(`Unsupported platform ${process.platform}`);
	const modsDirectory = path.join(mindustryDirectory, "mods");
	const launcherDataPath = path.join(mindustryDirectory, "launcher");
	const username = process.env["USERNAME"] ?? process.env["USER"] ?? null;

	//if settings file doesn't exist, 
	if(!fs.existsSync(path.join(launcherDataPath, "config.json"))){
		log("No config.json file found, creating one. If this is your first launch, this is fine.");
		if(!fs.existsSync(launcherDataPath)){
			fs.mkdirSync(launcherDataPath, {
				recursive: true
			});
		}
		fs.copyFileSync("template-config.json", path.join(launcherDataPath, "config.json"), fs.constants.COPYFILE_EXCL);
		if(opts.commandName != "config") log("Currently using default settings: run `mindustry config` to edit the settings file.");
	}
	
	const settings = parseJSONC(fs.readFileSync(path.join(launcherDataPath, "config.json"), "utf-8")) as Settings;

	if(opts.commandName != "config") validateSettings(settings, username);

	const externalMods = settings.externalMods.map(modPath => ({
		path: modPath,
		type: fs.existsSync(modPath) ?
			fs.lstatSync(modPath).isDirectory() ?
				fs.existsSync(path.join(modPath, "build.gradle")) ? "java" : "dir"
				: "file"
			: (error(`External mod "${modPath}" does not exist.`), "invalid") as "java" | "dir" | "file" | "invalid"
	}));

	return {
		settings,
		currentLogStream: null,
		launcherDataPath,
		mindustryDirectory,
		mindustryProcess: null,
		modsDirectory,
		username,
		namedArgs: opts.namedArgs,
		mindustryArgs: settings.processArgs,
		jvmArgs: settings.jvmArgs.concat(opts.positionalArgs),
		externalMods,
		buildMods: "buildMods" in opts.namedArgs,
		jarFile: {
			path: ""
		}
	};
}
