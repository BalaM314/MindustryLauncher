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
import { spawn, ChildProcess, execSync, SpawnSyncReturns } from "child_process";
import * as readline from "readline";
import * as https from "https";
import { Stream, TransformCallback, TransformOptions } from "stream";


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

function log(message: string){
	console.log(`${ANSIEscape.blue}[Launcher]${ANSIEscape.reset} ${message}`);
}
function error(message: string){
	console.error(`${ANSIEscape.blue}[Launcher]${ANSIEscape.reset} ${message}`);
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
		return `${ANSIEscape.cyan}[${new Date().toTimeString().split(" ")[0]}]${ANSIEscape.reset}`;
	else
		return `[${new Date().toTimeString().split(" ")[0]}]`;
}
function formatLine(line:string){
	return `${getTimeComponent(true)} ${getLogHighlight(line.toString()[1])}${line}`;
}
/**
 * Generates a chunk processor function from a function that processes one line at a time.
 * Does not work correctly.
 * */
function chunkProcessorGenerator(processor:(line:string, index:number) => string): (text:string) => string {
	return function(chunk:string):string {
		if(chunk == "") return "";
		if(chunk.match(/^\r?\n$/)) return chunk;
		return chunk.split(/(?<=\r?\n)/)
			.map(processor)
			.join("")
			+ ANSIEscape.reset;
	}
}
/**Creates a (? extends Stream.Transform) class from a function that processes one line at a time. */
function streamTransform(transformFunction: (text:string, index:number) => string){
	return class extends Stream.Transform {
		_transform(chunk: any, encoding: BufferEncoding, callback: TransformCallback): void {
			try {
				callback(null, chunkProcessorGenerator(transformFunction)(chunk.toString()));
			} catch(err){
				callback(err as any);
			}
		}
	}
}
/**
 * Generates a chunk processor function from a function that processes one line at a time but with indented : instead of applying the transform.
 * Does not work correctly.
 * */
function indentChunkProcessorGenerator(processor:(line:string) => string): (text:string, index:number) => string {
	return (line, index) => (line.match(/^\[\w\]/) || index == 0 ? processor(line) : `:          ${line}`);
}
const LoggerHighlightTransform = streamTransform(
	indentChunkProcessorGenerator(formatLine)
);

class PrependTextTransform extends Stream.Transform {
	constructor(public getText: () => string, opts?:TransformOptions){
		super(opts);
	}
	_transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
		callback(null, chunkProcessorGenerator((line) => `${this.getText()} ${line}`)(chunk.toString()));
	}
}
/**Removes a word from logs. Useful to hide your Windows username.*/
class CensorKeywordTransform extends Stream.Transform {
	constructor(public keyword:string, public replace:string, opts?:TransformOptions){
		super(opts);
	}
	_transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
		callback(null, chunk.toString().replaceAll(this.keyword, this.replace));
	}
}

function askQuestion(query:string): Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise(resolve => rl.question(query, ans => {
		rl.close();
		resolve(ans);
	}))
}

async function askYesOrNo(query:string): Promise<boolean> {
	let response = await askQuestion(query);
	return response == "y" || response == "yes"
}

const pathSeparator = process.platform == "win32" ? "\\" : "/";

let parsedArgs: {
	[index: string]: string;
};
let mindustryArgs: string[];

let vars: {
	filePath: string;
	jarName: string;
} = {
	filePath: "AMOGUS",
	jarName: "SUS"
};


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

let settings:Settings;

let mindustryProcess:ChildProcess;
let currentLogStream:fs.WriteStream;



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

function startProcess(_filePath: string, _jvmArgs: string[], _mindustryArgs: string[]){
	copyMods();
	const proc = spawn("java", _jvmArgs.concat(_mindustryArgs).concat([`-jar ${_filePath}`]).concat(settings.processArgs).join(" ").split(" "));
	const d = new Date();

	if(settings.logging.enabled){
		currentLogStream = fs.createWriteStream(
			`${settings.logging.path}${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}--${d.getHours()}-${d.getMinutes()}-${d.getSeconds()}.txt`
		);
		//Creates a write stream and pipes the output of the mindustry process into it.
		if(settings.logging.removeUsername)
			proc.stdout
				.pipe(new PrependTextTransform(() => getTimeComponent(false)))
				.pipe(new CensorKeywordTransform(process.env["USERNAME"]!, "[USERNAME]"))
				.pipe(currentLogStream);
		else
			proc.stdout
			.pipe(new PrependTextTransform(() => getTimeComponent(false)))
				.pipe(currentLogStream);
	}
	if(settings.logging.removeUsername){
		proc.stdout
			.pipe(new LoggerHighlightTransform())
			.pipe(new CensorKeywordTransform(process.env["USERNAME"]!, "[USERNAME]"))
			.pipe(process.stdout);
		proc.stderr
			.pipe(new LoggerHighlightTransform())
			.pipe(new CensorKeywordTransform(process.env["USERNAME"]!, "[USERNAME]"))
			.pipe(process.stderr);
	} else {
		proc.stdout
			.pipe(new LoggerHighlightTransform())
			.pipe(process.stdout);
		proc.stderr
			.pipe(new LoggerHighlightTransform())
			.pipe(process.stderr);
	}
	
	return proc;
}

function restart(_filePath: string, _jvmArgs: string[]){
	log("Restarting!");
	mindustryProcess.removeAllListeners();
	mindustryProcess.kill("SIGTERM");//todo see if this causes issues
	mindustryProcess = startProcess(_filePath, _jvmArgs, mindustryArgs);
	log("Started new process.");
}

function copyMods(){
	for(var file of settings.externalMods){
		log(`Copying mod ${file}`);
		let modname = file.match(/(?<=[/\\])[^/\\:*?"<>]+?(?=(Desktop)?\.jar$)/i);//hello regex my old friend
		if(modname == null){
			throw new Error(`Invalid mod filename ${file}!`);
		}
		fs.copyFileSync(file, `${process.env["appdata"]}\\Mindustry\\mods\\${modname[0]}.jar`);
	}
}

function parseJSONC(data:string):Settings {
	return JSON.parse(data.split("\n")
		.filter(line => !/^[ \t]*\/\//.test(line))
		//Removes lines that start with any amount of whitespaces or tabs and two forward slashes(comments).
		.map(line => line.replace(/\*.*?\*/g, ""))
		//Removes "multiline" comments.
		.join("\n")
	);
	
}

function downloadFile(version:string){
	return new Promise((resolve, reject) => {
		https.get(`https://github.com/Anuken/Mindustry/releases/download/${version}/Mindustry.jar`, (res) => {
			if(res.statusCode != 302){
				if(res.statusCode == 404){
					return reject("The specified version was not found.");
				}
				return reject("Expected status 302, got " + res.statusCode);
			}
			if(!res.headers.location) return reject("Redirect location not given");
			https.get(res.headers.location!, (res) => {
				const file = fs.createWriteStream(`${settings.mindustryJars.folderPath}${pathSeparator}${version}.jar`);
				res.pipe(file);
				file.on('finish', () => {
					file.close();
					resolve("File downloaded!");
				});
			})
		});
	});
}

async function handleDownload(){
	if(await askYesOrNo("Would you like to download the file? [y/n]")){
		try {
			log("Downloading...");
			log("There's no status bar so you just have to trust me.");
			await downloadFile("v"+parsedArgs["version"]);
			log("Done!");
			launch(true);
		} catch(err){
			error("An error occured while downloading the file: ");
			error(err as any);
		}
		return;
	}
}

function launch(recursive?:boolean){
	
	try {
		fs.accessSync(vars.filePath, fs.constants.R_OK);
	} catch(err){
		error(`Unable to access file ${vars.jarName}.`);
		if(recursive){
			error("Wait what? I just downloaded that.");
			error("Please contact BalaM314 by filing an issue on Github.");
		} else {
			error("If you have this version downloaded, check the config.json file to see if the specified filename is correct.")
			handleDownload();
		}
		return;
	}
	
	log(`Launching Mindustry version ${parsedArgs["version"]}`);
	if(mindustryArgs.length > 0){
		log(`Arguments: ${mindustryArgs}`);
	}

	mindustryProcess = startProcess(vars.filePath, settings.jvmArgs, mindustryArgs);

	process.stdin.on("data", (data) => {
		switch(data.toString("utf-8").slice(0, -2)){//Input minus the \r\n at the end.
			case "rs": case "restart":
				restart(vars.filePath, settings.jvmArgs);
			break;
			case "?": case "help":
				log(`Commands: 'restart', 'help'`);
			case "exit": case "e":
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
		if(statusCode == 0){
			log("Process exited.");
		} else {
			log(`Process crashed with exit code ${statusCode}!`);
		}
		process.exit();
	});


	for(var file of settings.externalMods){
		fs.watchFile(file, () => {
			log(`File change detected! (${file})`);
			copyMods();
			if(settings.restartAutomaticallyOnModUpdate)
				restart(vars.filePath, settings.jvmArgs);
		});
	}
}

function init(){
	settings = parseJSONC(fs.readFileSync("config.json", "utf-8"));

	for(let [version, jarName] of Object.entries(settings.mindustryJars.customVersionNames)){
		if(jarName.includes(" ")){
			error(`Jar name for version ${version} contains a space.`);
			process.exit(1);
		}
	}

	if(!(fs.existsSync(settings.mindustryJars.folderPath) && fs.lstatSync(settings.mindustryJars.folderPath).isDirectory)){
		error(`Specified path to put Mindustry jars (${settings.mindustryJars.folderPath}) does not exist or is not a directory.\n`);
		process.exit(1);
	}

	vars.jarName = settings.mindustryJars.customVersionNames[parsedArgs["version"]] ?? `v${parsedArgs["version"] ?? 135}.jar`;
	//Use the custom version name, but if it doesnt exist use "v${version}.jar";
	vars.filePath = vars.jarName.match(/[/\\]/gi) ? vars.jarName : settings.mindustryJars.folderPath + vars.jarName;
	//If the jar name has a / or \ in it then use it as an absolute path, otherwise relative to folderPath.
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
	process.chdir(process.argv[1].split(pathSeparator).slice(0,-1).join(pathSeparator));
	
	[parsedArgs, mindustryArgs] = parseArgs(processArgs.slice(2));

	init();

	if("help" in parsedArgs){
		console.log(
	`Usage: mindustry [--help] [--version <version>] [--compile] [-- jvmArgs]

	--help\tDisplays this help message and exits.
	--version\tSpecifies the version to use.
	--compile\tCompiles before launching, only works if the version points to a source directory.
	--\t\tTells the launcher to stop parsing args and send remaining arguments to the JVM.`
		);
		return 0;
	}

	if("update" in parsedArgs){
		updateLauncher()
			.then(message => {switch(message){
				case 0: log("Successfully updated."); break;
				case 1: log("Update aborted."); break;
			}})
			.catch((err:string) => {
				error("Update failed due to an error!");
				error(err);
			});
		return 0;
	}

	if("version" in parsedArgs){
		if(vars.filePath.match(/[/\\]$/i)){
			if("compile" in parsedArgs){
				try {
					fs.accessSync(`${vars.filePath}/desktop/build.gradle`);
				} catch(err){
					error(`Unable to find a build.gradle in ${vars.filePath}/desktop/build.gradle. Are you sure this is a Mindustry source directory?`);
					return 1;
				}
				log("Compiling...");
				let gradleProcess = spawn(`${vars.filePath}/gradlew.bat`, ["desktop:dist"], {
					cwd: vars.filePath
				});
				gradleProcess.stdout.pipe(new PrependTextTransform(() => `${ANSIEscape.brightpurple}[Gradle]${ANSIEscape.reset}`)).pipe(process.stdout);
				gradleProcess.stderr.pipe(new PrependTextTransform(() => `${ANSIEscape.brightpurple}[Gradle]${ANSIEscape.reset}`)).pipe(process.stderr);
				gradleProcess.on("exit", (code) => {
					if(code == 0){
						log("Compiled succesfully.");
						vars.jarName = "Mindustry.jar";
						vars.filePath += `desktop${pathSeparator}build${pathSeparator}libs${pathSeparator}Mindustry.jar`;
						launch();
					} else {
						error("Compiling failed.");
						process.exit(1);
					}
				});
				
			} else {
				try {
					fs.accessSync(`${vars.filePath}/desktop/build/libs/Mindustry.jar`);
				} catch(err){
					error(`Unable to find a Mindustry.jar in ${vars.filePath}/desktop/build/libs/Mindustry.jar. Are you sure this is a Mindustry source directory? You may need to compile first.`);
					return 1;
				}
				vars.jarName = "Mindustry.jar";
				vars.filePath += `desktop${pathSeparator}build${pathSeparator}libs${pathSeparator}Mindustry.jar`;
				launch();
			}
			
		} else {
			launch();
		}
	} else {
		log("Please specify a version to launch.");
	}
	return 0;
}
try {
	main(process.argv);
} catch(err){
	error("Unhandled runtime error!");
	throw err;
}