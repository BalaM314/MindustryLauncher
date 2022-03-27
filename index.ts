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
import { spawn, exec, type ChildProcess } from "child_process";
import * as readline from "readline";


const fileSeparator = process.platform == "win32" ? "\\" : "/";

process.chdir(process.argv[1].split(fileSeparator).slice(0,-1).join(fileSeparator));

let parsedArgs: {
	[index: string]: string;
} = parseArgs(process.argv.slice(2));


if(parsedArgs["help"]){
	console.log(
`Usage: mindustry [--help] [--version <version>]
--help\tDisplays this help message and exits.
--version\tSpecifies the version to use.`
	);
	process.exit();
}

if(parsedArgs["install"]){
	console.log("Trying to install.");
	if(/downloads/i.test(process.cwd())){
		console.error("ew why am I in a downloads directory please move me");
		process.exit(1);
	}
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
	rl.question(`You want to install to ${process.cwd()}, right? [y/n]`, (response) => {
		switch(response.toLowerCase()){
			case "y": case "yes":
				console.log("Installing...");
				try {
					fs.accessSync("config.json", fs.constants.R_OK);
					console.log("config.json file found.");
				} catch(err) {
					console.log("Creating a config.json file...");
					try {
						fs.copyFileSync("template-config.json", "config.json");
						console.log("Done.");
					} catch(err){
						console.error("Failed to create config.json file! " + (err as Error)?.message);
						process.exit(1);
					}
				}
				rl.question("You will need to edit the config.json file. Open it? [y/n]", (response) => {
					switch(response.toLowerCase()){
						case "y": case "yes":
							exec("notepad config.json");
							break;
					}
					console.log("Installation successful.");
					process.exit(1);
				})
				break;
			default:
				console.log("Installation aborted.");
				process.exit(1);
		}
	});

} else {
	try {
		fs.accessSync("config.json", fs.constants.R_OK);
	} catch(err) {
		console.error("Can't find the config.json file!");
		console.error("You may need to create one, try running again with --install.");
		process.exit(1);
	}
}



interface Settings {
	mindustryJars: {
		folderPath: string;
		versionNames: {
			[index: string]: string;
		}
	};
	jvmArgs: string[];
	externalMods: string[];
	restartAutomaticallyOnModUpdate: boolean;
	logging: {
		path: string;
		enabled: boolean;
	};
}

let settings:Settings;

let mindustryProcess:ChildProcess;
let currentLogStream:fs.WriteStream;



function parseArgs(args: string[]){
	let parsedArgs: {
		[index: string]: string;
	} = {};
	let argName:string = "null";
	for (let arg of args) {
		if(arg.startsWith("--")){
			argName = arg.slice(2);
			parsedArgs[arg.toLowerCase().slice(2)] = "null";
		} else if(argName){
			parsedArgs[argName] = arg.toLowerCase();
			argName = "null";
		}
	}
	return parsedArgs;
}

function startProcess(_filePath: string, _jvmArgs: string[]){
	const proc = spawn("java", [`-jar ${_filePath}`].concat(_jvmArgs).join(" ").split(" "));
	const d = new Date();
	if(settings.logging.enabled){
		currentLogStream = fs.createWriteStream(`${settings.logging.path}${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}--${d.getHours()}-${d.getMinutes()}-${d.getSeconds()}.txt`);
		proc.stdout.pipe(currentLogStream);
	}
	proc.stdout.pipe(process.stdout);
	proc.stderr.pipe(process.stderr);
	return proc;
}

function restart(_filePath: string, _jvmArgs: string[]){
	console.log("Restarting!");
	mindustryProcess.removeAllListeners();
	mindustryProcess.kill("SIGTERM");//todo see if this causes issues
	mindustryProcess = startProcess(_filePath, _jvmArgs);
	console.log("Started new process.");
}

function copyMods(){
	for(var file of settings.externalMods){
		console.log(`Copying mod ${file}`);
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
		.join("\n")
	);
	//Removes lines that start with any amount of whitespaces or tabs and two forward slashes(comments).
}

function main(){
	settings = parseJSONC(fs.readFileSync("config.json", "utf-8"));

	for(let [version, jarName] of Object.entries(settings.mindustryJars.versionNames)){
		if(jarName.includes(" ")){
			throw new Error(`Jar name for version ${version} contains a space.`);
		}
	}

	let jarName = settings.mindustryJars.versionNames[parsedArgs["version"]] ?? settings.mindustryJars.versionNames["135"];
	let filePath = jarName.match(/[/\\]/gi) ? jarName : settings.mindustryJars.folderPath + jarName;

	console.log(`Launching Mindustry version ${settings.mindustryJars.versionNames[parsedArgs["version"]] ? parsedArgs["version"] : "135"}`)


	copyMods();

	mindustryProcess = startProcess(filePath, settings.jvmArgs);

	process.stdin.on("data", (data) => {
		switch(data.toString("utf-8").slice(0, -2)){
			case "rs": case "restart":
				restart(filePath, settings.jvmArgs);
			break;
			default:
				console.log("Unknown command.");
				break;
		}
	});

	mindustryProcess.on("exit", (statusCode) => {
		if(statusCode == 0){
			console.log("Process exited.");
		} else {
			console.log(`Process crashed with exit code ${statusCode}!`);
		}
		process.exit();
	});


	for(var file of settings.externalMods){
		fs.watchFile(file, () => {
			console.log(`File change detected! (${file})`);
			copyMods();
			if(settings.restartAutomaticallyOnModUpdate)
				restart(filePath, settings.jvmArgs);
		});
	}
}

if(!parsedArgs["install"])
	main();
