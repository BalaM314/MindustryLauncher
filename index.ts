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

import { ChildProcess, execSync, spawn, SpawnSyncReturns } from "child_process";
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
	modsDirectory: string;
	launcherDataPath: string;
	username: string | null;
	parsedArgs: {
		[index: string]: string;
	};
	mindustryProcess: ChildProcess | null;
	currentLogStream: fs.WriteStream | null;
	mindustryArgs: string[];
	jvmArgs: string[];
	jarFilePath: string;
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



function log(message:string){
	console.log(`${ANSIEscape.blue}[Launcher]${ANSIEscape.reset} ${message}`);
}
function error(message:string){
	console.error(`${ANSIEscape.blue}[Launcher]${ANSIEscape.reset} ${message}`);
}
function debug(message:string){
	console.debug(`${ANSIEscape.gray}[DEBUG]${ANSIEscape.reset} ${message}`);
}
function fatal(message:string):never {
	throw new Error(message);
}
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
function getTimeComponent(highlighted:boolean){
	if(highlighted)
		return `${ANSIEscape.cyan}[${new Date().toTimeString().split(" ")[0]}]`;
	else
		return `[${new Date().toTimeString().split(" ")[0]}]`;
}
function formatLine(line:string){
	return `${getTimeComponent(true)} ${getLogHighlight(line.toString()[1])}${line}`;
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
	}
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
	let response = await askQuestion(query);
	return response == "y" || response == "yes";
}

function copyDirectory(source:string, destination:string) {
	fs.mkdirSync(destination, {recursive: true});
	fs.readdirSync(source, {withFileTypes: true}).forEach(entry => {
		let sourcePath = path.join(source, entry.name);
		let destinationPath = path.join(destination, entry.name);

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

function parseArgs(args: string[]): [parsedArgs: {[index: string]: string;}, mindustryArgs: string[]]{
	//Parses arguments into a useable format.
	
	let parsedArgs: {
		[index: string]: string;
	} = {};
	let argName:string = "null";
	let mindustryArgs = [];
	let mode = 0;
	for (let arg of args) {
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

function downloadFile(url:string, output:string){
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			if(res.statusCode == 404){
				reject(`File does not exist.`);
			} else if(res.statusCode != 200){
				reject(`Expected status code 200, got ${res.statusCode}`);
			}
			const file = fs.createWriteStream(output);
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
		{
			shell: false
		}
	);
	const d = new Date();

	if(state.settings.logging.enabled){
		state.currentLogStream = fs.createWriteStream(
			`${state.settings.logging.path}${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}--${d.getHours()}-${d.getMinutes()}-${d.getSeconds()}.txt`
		);
		//Creates a write stream and pipes the output of the mindustry process into it.
		if(state.settings.logging.removeUsername)
			proc.stdout
				.pipe(new (prependTextTransform(() => getTimeComponent(false))))
				.pipe(new CensorKeywordTransform(process.env["USERNAME"]!, "[USERNAME]"))
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
	if(build) copyMods(state);
	if(compile) error("Compiling mods on restart is not yet implemented because this bit of code doesn't know what to compile");
	state.mindustryProcess = startProcess(state);
	log("Started new process.");
}

function copyMods(state:State){
	for(let file of state.settings.externalMods){
		if(!fs.existsSync(file)){
			error(`Mod "${file}" does not exist.`);
			continue;
		}
		if(fs.lstatSync(file).isDirectory()){
			if(fs.existsSync(path.join(file, "build.gradle"))){

				log(`Copying and building java mod directory "${file}"`);
				const preBuildTime = Date.now();
				try {
					execSync("gradlew jar", {
						cwd: file
					});
				} catch(err){
					fatal(`Build failed!`);
				}
				const timeTaken = Date.now() - preBuildTime;
				log(`Built ${file} in ${timeTaken.toFixed(0)}ms`);
				let modFile = fs.readdirSync(path.join(file, "build", "libs"))[0];
				let modName = modFile.match(/[^/\\:*?"<>]+?(?=(Desktop?\.jar$))/i)?.[0];
				fs.copyFileSync(
					path.join(file, "build", "libs", modFile),
					path.join(state.modsDirectory, modName + ".jar")
				);

			} else {
				log(`Copying mod directory "${file}"`);
				copyDirectory(file, path.join(state.modsDirectory, file.split(/[\/\\]/).at(-1)!));//TODO error handle
			}
		} else {
			let modname = file.match(/(?<=[/\\])[^/\\:*?"<>]+?(?=((Desktop)?\.(jar))|(zip)$)/i);//hello regex my old friend
			if(modname == null){
				error(`Invalid mod filename ${file}!`);
			} else {
				log(`Copying modfile "${file}"`);
				fs.copyFileSync(file, path.join(state.modsDirectory, `${modname[0]}.jar`));//TODO refactor this section, it won't work on .zip files
			}
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
			let versionNumber = version.match(/(?<=^foo-)\d+$/i)![0]!;
			resolveRedirect(`https://github.com/mindustry-antigrief/mindustry-client-v7-builds/releases/download/${versionNumber}/desktop.jar`)
				.then(response => resolve(response))
				.catch(error => reject(error));
		} else if(version.match(/(?<=be-)\d+$/i)){
			//Bleeding edge version
			let versionNumber = version.match(/(?<=be-)\d+$/i)![0]!;
			resolveRedirect(`https://github.com/Anuken/MindustryBuilds/releases/download/${versionNumber}/Mindustry-BE-Desktop-${versionNumber}.jar`)
				.then(response => resolve(response))
				.catch(error => reject(error));
		} else if(version == "foo"){
			https.get(`https://github.com/mindustry-antigrief/mindustry-client-v7-builds/releases/latest`, (res) => {
				if(res.statusCode != 302){
					reject(`Error: Expected status 302, got ${res.statusCode}`);
				}
				if(res.headers.location){
					let versionNumber = res.headers.location.match(/(?<=\/tag\/)\d+/)?.[0];
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
					let versionNumber = res.headers.location.match(/(?<=\/tag\/)\d+/)?.[0];
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

	if(await askYesOrNo("Would you like to download the file? [y/n]")){
		try {
			log("Resolving version...")
			let downloadPath = await getPathOfVersion(state.parsedArgs["version"]);
			
			log("Downloading...");
			log("There's no status bar so you just have to trust me.");
			await downloadFile(downloadPath, path.join(`${state.settings.mindustryJars.folderPath}`, `v${state.parsedArgs["version"]}.jar`));
			log("Done!");
		} catch(err){
			error("An error occured while downloading the file: ");
			error(err as any);
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
			error("If you have this version downloaded, check the config.json file to see if the specified filename is correct.")
			handleDownload(state)
				.then((worked) => {
					if(worked){
						launch(state, true)
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
				log(`Commands: 'restart', 'help', 'exit'`);
				break;
			case "exit": case "e":
				log("Exiting...");
				state.mindustryProcess?.removeAllListeners();
				state.mindustryProcess?.kill("SIGTERM");
				process.exit(0);
			default:
				log("Unknown command.");
				break;
		}
	});


	if(state.settings.restartAutomaticallyOnModUpdate){
		for(let filepath of state.settings.externalMods){
			let file = fs.lstatSync(filepath).isDirectory() ? path.join(filepath, "build", "libs") : filepath;
			//TODO this handling seems wrong
			fs.watchFile(file, () => {
				log(`File change detected! (${file})`);
				restart(state, true, false);
			});
		}
	}

}

function init(processArgs:string[]):State {
	//Change working directory to the same as this program's index.js file
	process.chdir(process.argv[1].split(path.sep).slice(0,-1).join(path.sep));

	//Parse arguments
	let [parsedArgs, jvmArgs] = parseArgs(processArgs.slice(2));

	
	//check settings
	let mindustryDirectory =
		process.platform == "win32" ? path.join(process.env["APPDATA"]!, "Mindustry/") :
		process.platform == "darwin" ? path.normalize("~/.local/share/Mindustry/") : 
		process.platform == "linux" ? path.normalize("") :
		fatal(`Unsupported platform ${process.platform}`);
	let modsDirectory = path.join(mindustryDirectory, "mods");
	let launcherDataPath = path.join(mindustryDirectory, "launcher");
	let username = process.env["USERNAME"] ?? process.env["USER"] ?? null;

	if(!fs.existsSync(path.join(launcherDataPath, "config.json"))){
		log("No config.json file found, creating one. If this is your first launch, this is fine.");
		if(!fs.existsSync(launcherDataPath)){
			fs.mkdirSync(launcherDataPath);
		}
		fs.copyFileSync("template-config.json", path.join(launcherDataPath, "config.json"));
		log("Opening the file. You will need to edit it.");
		try {
			execSync(`code ${path.join(launcherDataPath, "config.json")}`);
		} catch(err){
			execSync(`notepad ${path.join(launcherDataPath, "config.json")}`);
		}
	}
	
	let settings = parseJSONC(fs.readFileSync(path.join(launcherDataPath, "config.json"), "utf-8")) as Settings;

	for(let [version, jarName] of Object.entries(settings.mindustryJars.customVersionNames)){
		if(jarName.includes(" ")){
			error(`Jar name for version ${version} contains a space.`);
			process.exit(1);
		}
	}

	if(username == null) settings.logging.removeUsername = false;

	if(!(fs.existsSync(settings.mindustryJars.folderPath) && fs.lstatSync(settings.mindustryJars.folderPath).isDirectory)){
		error(`Specified path to put Mindustry jars (${settings.mindustryJars.folderPath}) does not exist or is not a directory.\n`);
		process.exit(1);
	}

	//Use the custom version name, but if it doesnt exist use "v${version}.jar";
	let jarName = settings.mindustryJars.customVersionNames[parsedArgs["version"]] ?? `v${parsedArgs["version"] ?? 135}.jar`;
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
		jvmArgs: settings.jvmArgs.concat(jvmArgs)
	};
}

function updateLauncher():Promise<number>{ return new Promise((resolve, reject) => {
	function fatalError(err:SpawnSyncReturns<Buffer>){
		reject(
`A command failed to complete. stdout:
${err.stdout.toString()}
stderr:
${err.stderr.toString()}`
		);
	}
	function commitChanges(){
		execSync("git add .");
		execSync(`git commit -m "[MindustryLauncher] Automated commit: update"`);
	}
	function pull(){
		execSync("git pull");
	}


	log("Updating...");
	try {
		execSync(`${process.platform == "win32" ? "where" : "which"} git`);
	} catch(err){
		reject("Unable to update automatically as you do not have Git installed.");
	}
	try {
		pull();
		resolve(0);
	} catch(err){
		let errorMessage = (err as SpawnSyncReturns<Buffer>).stderr.toString();
		let outputMessage = (err as SpawnSyncReturns<Buffer>).stdout.toString();
		if(outputMessage.includes("Merge conflict")){
			execSync("git merge --abort");
			reject("✨mergeconflict✨\nYou have merge conflicts!!11!1!1\nThe merge has been aborted. Please attempt to pull and resolve conflicts manually.");
		} else if(errorMessage.includes("commit your changes")){
			askYesOrNo(`${ANSIEscape.blue}[Launcher]${ANSIEscape.reset} Failed to update because you have local changes. Would you like to commit them?\nIf you don't know what this means, type yes. [y/n]:`)
			.then(response => {
				if(response){
					try {
						commitChanges();
						pull();
						resolve(0);
					} catch(err){
						let outputMessage = (err as SpawnSyncReturns<Buffer>).stdout.toString();
						if(outputMessage.includes("Merge conflict")){
							execSync("git merge --abort");
							reject("✨mergeconflict✨\nYou have merge conflicts!!11!1!1\nThe merge has been aborted. Please attempt to pull and resolve conflicts manually.");
						} else {
							fatalError(err as SpawnSyncReturns<Buffer>);
						}
					}
				} else {
					resolve(1);
				}
			});
		} else {
			fatalError(err as SpawnSyncReturns<Buffer>)
		}
	}

	});
};

function main(processArgs:typeof process.argv):number {
	//Change working directory to directory the file is in, otherwise it would be wherever you ran the command from

	let filePath:string, mindustryDirectory:string;
	let state = init(processArgs);

	if("help" in state.parsedArgs){
		console.log(
	`Usage: mindustry [--help] [--version <version>] [--compile] [-- jvmArgs]

	--help\tDisplays this help message and exits.
	--version\tSpecifies the version to use.
	--compile\tCompiles before launching, only works if the version points to a source directory.
	--\t\tTells the launcher to stop parsing args and send remaining arguments to the JVM.`
		);
		return 0;
	}

	if("update" in state.parsedArgs){
		updateLauncher()
			.then(message => {switch(message){
				case 0: log("Successfully updated."); break;
				case 1: log("Update aborted."); break;
			}})
			.catch((err:string) => {
				error("Update failed due to an error!");
				error(err);
			});
		return -1;
	}

	if("version" in state.parsedArgs){
		if(state.jarFilePath.match(/[/\\]$/i)){
			if("compile" in state.parsedArgs){
				try {
					fs.accessSync(`${state.jarFilePath}/desktop/build.gradle`);
				} catch(err){
					error(`Unable to find a build.gradle in ${state.jarFilePath}/desktop/build.gradle. Are you sure this is a Mindustry source directory?`);
					return 1;
				}
				log("Compiling...");
				let gradleProcess = spawn(`${state.jarFilePath}/gradlew.bat`, ["desktop:dist"], {
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
						filePath += `desktop${path.sep}build${path.sep}libs${path.sep}Mindustry.jar`;
						if("buildMods" in state.parsedArgs) copyMods(state);
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
				if("buildMods" in state.parsedArgs) copyMods(state);
				launch(state, false);
			}
			
		} else {
			if("buildMods" in state.parsedArgs) copyMods(state);
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
	if(typeof err == "string"){
		error("Exiting due to fatal error.");
	} else {
		error("Unhandled runtime error!");
		throw err;
	}
}