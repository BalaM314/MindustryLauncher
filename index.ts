#!/usr/bin/env node
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

import { ChildProcess, execSync, spawn, spawnSync, SpawnSyncReturns } from "child_process";
import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import * as readline from "readline";
import { Stream, TransformCallback, TransformOptions } from "stream";


interface Settings {
	mindustryJars: {
		folderPath: string;
		customVersionNames: {
			[index: string]: string;
		}
	};
	jvmArgs: string[];
	processArgs: string[];
	externalMods: string[];
	restartAutomaticallyOnModUpdate: boolean;
	watchWholeJavaModDirectory: boolean;
	logging: {
		path: string;
		enabled: boolean;
		removeUsername: boolean;
	};
}

interface State {
	settings: Settings;
	/**The path of the Mindustry data directory. */
	mindustryDirectory: string;
	/**The path of the Mindustry mods directory. */
	modsDirectory: string;
	/**The path of the folder used to store launcher data. */
	launcherDataPath: string;
	/**The current user's username, used to censor it in log output. */
	username: string | null;
	/**The named arguments passed to the program. */
	parsedArgs: {
		[index: string]: string;
	};
	mindustryProcess: ChildProcess | null;
	currentLogStream: fs.WriteStream | null;
	mindustryArgs: string[];
	jvmArgs: string[];
	/**Path to the Mindustry jar file. */
	jarFilePath: string;
	externalMods: {
		path: string;
		type: "file" | "dir" | "java";
	}[];
	buildMods: boolean;
}


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

class LauncherError extends Error {
	constructor(message?:string){
		super(message);
		this.name = "LauncherError";
	}
}

function log(message:string){
	console.log(`${ANSIEscape.blue}[Launcher]${ANSIEscape.reset} ${message}`);
}
function error(message:string){
	console.error(`${ANSIEscape.blue}[Launcher]${ANSIEscape.red} ${message}${ANSIEscape.reset}`);
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function debug(message:string){
	console.debug(`${ANSIEscape.gray}[DEBUG]${ANSIEscape.reset} ${message}`);
}
function fatal(message:string):never {
	throw new LauncherError(message);
}
/**Returns the proper highlight color for a line based on the character inside [x] */
function getLogHighlight(char:string){
	switch(char){
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
function getTimeComponent(color:boolean){
	if(color)
		return `${ANSIEscape.cyan}[${new Date().toTimeString().split(" ")[0]}]`;
	else
		return `[${new Date().toTimeString().split(" ")[0]}]`;
}
function formatLine(line:string){
	return `${getTimeComponent(true)} ${getLogHighlight(line[1])}${line}`;
}

/**Creates a (? extends Stream.Transform) class from a function that processes one line at a time. */
function streamTransform(transformFunction: (text:string, chunkIndex:number) => string){
	return class extends Stream.Transform {
		private _line: string;
		constructor(opts?:TransformOptions){
			super(opts);
			this._line = "";
		}
		_transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
			this._line += chunk.toString();
			const lines = this._line.split(/\r?\n/);
			callback(
				null,
				lines
					.slice(0, -1)
					.map(line => line + "\n")
					.map(transformFunction)
					.join("")
			);
			this._line = lines.at(-1)!;
		}
	};
}

const LoggerHighlightTransform = streamTransform(
	(line, index) => (line.match(/^\[\w\]/) || index == 0 ? formatLine(line) : `:          ${line}`)
);
function prependTextTransform(text: string | (() => string)){
	return streamTransform((line) => `${text instanceof Function ? text() : text} ${line}`);
}

/**Removes a word from logs. Useful to hide your Windows username.*/
class CensorKeywordTransform extends Stream.Transform {
	constructor(public keyword:string, public replace:string, opts?:TransformOptions){
		super(opts);
	}
	_transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback):void {
		callback(null, chunk.toString().replaceAll(this.keyword, this.replace));
	}
}

function askQuestion(query:string):Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise(resolve => rl.question(query, ans => {
		rl.close();
		resolve(ans);
	}));
}

async function askYesOrNo(query:string):Promise<boolean> {
	const response = await askQuestion(query);
	return response == "y" || response == "yes";
}

/**Copies a directory recursively. */
function copyDirectory(source:string, destination:string) {
	fs.mkdirSync(destination, {recursive: true});
	fs.readdirSync(source, {withFileTypes: true}).forEach(entry => {
		const sourcePath = path.join(source, entry.name);
		const destinationPath = path.join(destination, entry.name);

		entry.isDirectory() ? copyDirectory(sourcePath, destinationPath) : fs.copyFileSync(sourcePath, destinationPath);
	});
}

function parseJSONC(data:string) {
	return JSON.parse(data.split("\n")
		.filter(line => !/^[ \t]*\/\//.test(line))
		//Removes lines that start with any amount of whitespaces or tabs and two forward slashes(comments).
		.map(line => line.replace(/\*.*?\*/g, ""))
		//Removes "multiline" comments.
		.join("\n")
	);
}

function throwIfError(output:SpawnSyncReturns<Buffer>){
	if(output.error) throw output.error;
}

/**Parses arguments into a useable format. */
function parseArgs(args: string[]): [parsedArgs: {[index: string]: string;}, mindustryArgs: string[]]{
	
	const parsedArgs: {
		[index: string]: string;
	} = {};
	let argName:string = "null";
	const mindustryArgs = [];
	let mode = 0;
	for (const arg of args) {
		if(arg == "--"){
			//The remaining args need to be sent to the JVM.
			mode = 1;
			continue;
		}
		if(mode == 1){
			mindustryArgs.push(arg);
		}
		if(arg.startsWith("--")){
			argName = arg.slice(2);
			parsedArgs[arg.toLowerCase().slice(2)] = "null";
		} else if(argName){
			parsedArgs[argName] = arg.toLowerCase();
			argName = "null";
		}
	}
	return [parsedArgs, mindustryArgs];
}

function downloadFile(url:string, outputPath:string){
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			if(res.statusCode == 404){
				reject(`File does not exist.`);
			} else if(res.statusCode != 200){
				reject(`Expected status code 200, got ${res.statusCode}`);
			}
			const file = fs.createWriteStream(outputPath);
			res.pipe(file);
			file.on('finish', () => {
				file.close();
				resolve("File downloaded!");
			});
		});
	});
}




function startProcess(state:State){
	const proc = spawn(
		"java",
		[...state.jvmArgs, `-jar`, state.jarFilePath, ...state.mindustryArgs],
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
function restart(state:State, build:boolean, compile:boolean){
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
	if(compile) error("Compiling client on restart is not yet implemented because this bit of code doesn't know what to compile");
	state.mindustryProcess = startProcess(state);
	log("Started new process.");
}

function copyMods(state:State){
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
			
			const modFileName = fs.readdirSync(path.join(mod.path, "build", "libs"))[0];
			const modFilePath = path.join(mod.path, "build", "libs", modFileName);
			if(!fs.existsSync(modFilePath)){
				if(state.buildMods){
					error(`Java mod directory "${mod.path}" does not have a mod file in build/libs/, skipping copying.`);
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
			copyDirectory(mod.path, path.join(state.modsDirectory, path.basename(mod.path)));
		} else if(mod.type == "file"){
			//Copy the mod file
			let modname = path.basename(mod.path).split(".").slice(0, -1).join(".");
			if(modname == "") modname = path.basename(mod.path);
			log(`Copying modfile "${mod.path}"`);
			fs.copyFileSync(mod.path, path.join(state.modsDirectory, modname[0] + path.extname(mod.path)));
		}
	}
}

function resolveRedirect(url:string):Promise<string> {
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			if(res.statusCode != 302){
				if(res.statusCode == 404){
					reject("Version does not exist.");
				} else {
					reject(`Error: Expected status 302, got ${res.statusCode}`);
				}
			}
			if(res.headers.location){
				resolve(res.headers.location);
			} else {
				reject(`Error: Server did not respond with redirect location.`);
			}
		});
	});
}

function getPathOfVersion(version:string):Promise<string> {
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

async function handleDownload(state:State){

	if(await askYesOrNo("Would you like to download the file? [y/n]:")){
		try {
			log("Resolving version...");
			const downloadPath = await getPathOfVersion(state.parsedArgs["version"]);
			
			log("Downloading...");
			log("There's no status bar so you just have to trust me.");
			await downloadFile(downloadPath, path.join(`${state.settings.mindustryJars.folderPath}`, `v${state.parsedArgs["version"]}.jar`));
			log("Done!");
		} catch(err){
			error("An error occured while downloading the file: ");
			if(err instanceof Error){
				error(err.message);
			} else {
				console.error(err);
			}
			return false;
		}
		return true;
	} else {
		log("Exiting.");
	}
}

function launch(state:State, recursive:boolean){
	
	try {
		fs.accessSync(state.jarFilePath, fs.constants.R_OK);
	} catch(err){
		error(`Unable to access file "${state.jarFilePath}".`);
		if(recursive){
			error("Wait what? I just downloaded that.");
			error("Please contact BalaM314 by filing an issue on Github.");
		} else {
			error("If you have this version downloaded, check the config.json file to see if the specified filename is correct.");
			handleDownload(state)
				.then((worked) => {
					if(worked){
						launch(state, true);
					}
				});
		}
		return;
	}
	
	log(`Launching Mindustry version ${state.parsedArgs["version"]}`);
	if(state.mindustryArgs.length > 0){
		log(`Arguments: ${state.mindustryArgs}`);
	}

	state.mindustryProcess = startProcess(state);

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

/**Returns a State given process args. */
function init(processArgs:string[]):State {
	//Change working directory to the same as this program's index.js file
	process.chdir(process.argv[1].split(path.sep).slice(0,-1).join(path.sep)); //Use of process.argv is necessary to grab the "hidden" argument to `node`

	//Parse arguments
	const [parsedArgs, jvmArgs] = parseArgs(processArgs.slice(2));

	//Get a bunch of static things
	const mindustryDirectory =
	process.platform == "win32" ? path.join(process.env["APPDATA"]!, "Mindustry/") :
		process.platform == "darwin" ? path.normalize("~/.local/share/Mindustry/") : 
			process.platform == "linux" ? path.normalize("") :
				fatal(`Unsupported platform ${process.platform}`);
	const modsDirectory = path.join(mindustryDirectory, "mods");
	const launcherDataPath = path.join(mindustryDirectory, "launcher");
	const username = process.env["USERNAME"] ?? process.env["USER"] ?? null;

	//if settings file doesn't exist, 
	if(!fs.existsSync(path.join(launcherDataPath, "config.json"))){
		log("No config.json file found, creating one. If this is your first launch, this is fine.");
		if(!fs.existsSync(launcherDataPath)){
			fs.mkdirSync(launcherDataPath);
		}
		fs.copyFileSync("template-config.json", path.join(launcherDataPath, "config.json"), fs.constants.COPYFILE_EXCL);
		log("Currently using default settings: run `mindustry --config` to edit the settings file.");
	}
	
	const settings = parseJSONC(fs.readFileSync(path.join(launcherDataPath, "config.json"), "utf-8")) as Settings;

	for(const [version, jarName] of Object.entries(settings.mindustryJars.customVersionNames)){
		if(jarName.includes(" ")){
			fatal(`Jar name for version ${version} contains a space.`);
		}
	}

	if(username == null && settings.logging.removeUsername){
		error("Could not determine your username, disabling logging.removeUsername");
		settings.logging.removeUsername = false;
	}

	if(!(fs.existsSync(settings.mindustryJars.folderPath) && fs.lstatSync(settings.mindustryJars.folderPath).isDirectory)){
		error(`Specified path to put Mindustry jars (${settings.mindustryJars.folderPath}) does not exist or is not a directory.\n`);
		process.exit(1);
	}

	const externalMods = settings.externalMods.map(modPath => ({
		path: modPath,
		type: fs.existsSync(modPath) ?
			fs.lstatSync(modPath).isDirectory() ?
				fs.existsSync(path.join(modPath, "build.gradle")) ? "java" : "dir"
				: "file"
			: fatal(`External mod "${modPath}" does not exist.`) as "file" | "dir" | "java"
	}));

	//Use the custom version name, but if it doesnt exist use "v${version}.jar";
	const jarName = settings.mindustryJars.customVersionNames[parsedArgs["version"]] ?? `v${parsedArgs["version"] ?? 135}.jar`;
	//If the jar name has a / or \ in it then use it as an absolute path, otherwise relative to folderPath.
	let jarFilePath = jarName.match(/[/\\]/gi) ? jarName : settings.mindustryJars.folderPath + jarName;
	jarFilePath = jarFilePath.replace(/%[^ %]+?%/g, (text:string) => 
		process.env[text.split("%")[1]] ?? text
	);
	return {
		settings,
		currentLogStream: null,
		jarFilePath,
		launcherDataPath,
		mindustryDirectory,
		mindustryProcess: null,
		modsDirectory,
		username,
		parsedArgs,
		mindustryArgs: settings.processArgs,
		jvmArgs: settings.jvmArgs.concat(jvmArgs),
		externalMods,
		buildMods: "buildMods" in parsedArgs
	};
}

function main(processArgs:typeof process.argv):number {
	//Change working directory to directory the file is in, otherwise it would be wherever you ran the command from

	const state = init(processArgs);

	if("help" in state.parsedArgs){
		console.log(
	`Usage: mindustry [--help] [--version <version>] [--compile] [--buildMods] [--update] [-- jvmArgs]

	--help\tDisplays this help message and exits.
	--version\tSpecifies the version to use.
	--compile\tCompiles before launching, only works if the version points to a source directory.
	--config\tOpens the launcher's settings file.
	--buildMods\tBuilds java mod directories before copying them.
	--\t\tTells the launcher to stop parsing args and send remaining arguments to the JVM.`
		);
		return 0;
	}

	if("config" in state.parsedArgs){
		const settingsPath = path.join(state.launcherDataPath, "config.json");
		try {
			log(`Opening ${settingsPath}`);
			throwIfError(spawnSync("code.cmd", [settingsPath]));
			log(`Editor closed.`);
		} catch(err){
			error(err as string);
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
	}

	if(state.parsedArgs["version"]){
		if(state.jarFilePath.match(/[/\\]$/i)){
			if("compile" in state.parsedArgs){
				try {
					fs.accessSync(`${state.jarFilePath}/desktop/build.gradle`);
				} catch(err){
					error(`Unable to find a build.gradle in ${state.jarFilePath}/desktop/build.gradle. Are you sure this is a Mindustry source directory?`);
					return 1;
				}
				log("Compiling...");
				const gradleProcess = spawn(`${state.jarFilePath}/gradlew.bat`, ["desktop:dist"], {
					cwd: state.jarFilePath
				});
				gradleProcess.stdout
					.pipe(new (prependTextTransform(`${ANSIEscape.brightpurple}[Gradle]${ANSIEscape.reset}`)))
					.pipe(process.stdout);
				gradleProcess.stderr
					.pipe(new (prependTextTransform(`${ANSIEscape.brightpurple}[Gradle]${ANSIEscape.reset}`)))
					.pipe(process.stderr);
				gradleProcess.on("exit", (code) => {
					if(code == 0){
						log("Compiled succesfully.");
						state.jarFilePath = path.join(state.jarFilePath, "desktop/build/libs/Mindustry.jar");
						copyMods(state);
						launch(state, false);
					} else {
						error("Compiling failed.");
						process.exit(1);
					}
				});
				
			} else {
				try {
					fs.accessSync(path.join(state.jarFilePath, `desktop/build/libs/Mindustry.jar`));
				} catch(err){
					error(`Unable to find a Mindustry.jar in ${path.join(state.jarFilePath, `desktop/build/libs/Mindustry.jar`)}. Are you sure this is a Mindustry source directory? You may need to compile first.`);
					return 1;
				}
				state.jarFilePath += `desktop${path.sep}build${path.sep}libs${path.sep}Mindustry.jar`;
				copyMods(state);
				launch(state, false);
			}
			
		} else {
			copyMods(state);
			launch(state, false);
		}
	} else {
		log("Please specify a version to launch.");
	}
	return 0;
}



try {
	main(process.argv);
} catch(err){
	if(err instanceof LauncherError){
		error(err.message);
		error("Exiting due to fatal error.");
	} else {
		error("Unhandled runtime error!");
		throw err;
	}
}