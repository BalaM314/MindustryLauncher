/**
Copyright © <BalaM314>, 2022.
This file is part of MindustryLauncher.
MindustryLauncher is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
MindustryLauncher is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
You should have received a copy of the GNU Lesser General Public License along with MindustryLauncher. If not, see <https://www.gnu.org/licenses/>.

Contains various util functions and other things.
*/

import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import * as readline from "readline";
import { SpawnSyncReturns } from "child_process";
import { Stream, TransformCallback, TransformOptions } from "stream";

export const ANSIEscape = {
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
const commandColor = ANSIEscape.reset;

export class LauncherError extends Error {
	constructor(message?:string){
		super(message);
		this.name = "LauncherError";
	}
}

export function log(message:string){
	console.log(`${ANSIEscape.blue}[Launcher]${ANSIEscape.reset} ${message}${commandColor}`);
}
export function error(message:string){
	console.error(`${ANSIEscape.blue}[Launcher]${ANSIEscape.red} ${message}${commandColor}`);
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function debug(message:string){
	console.debug(`${ANSIEscape.gray}[DEBUG]${ANSIEscape.reset} ${message}${commandColor}`);
}
export function fatal(message:string):never {
	throw new LauncherError(message);
}



/**Returns the proper highlight color for a line based on the character inside [x] */
export function getLogHighlight(char:string){
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
export function getTimeComponent(color:boolean){
	if(color)
		return `${ANSIEscape.cyan}[${new Date().toTimeString().split(" ")[0]}]`;
	else
		return `[${new Date().toTimeString().split(" ")[0]}]`;
}
export function formatLine(line:string){
	return `${getTimeComponent(true)} ${getLogHighlight(line[1])}${line}${commandColor}`;
}

/**Creates a subclass of Stream.Transform from a function that processes one line at a time. */
export function streamTransform(transformFunction: (text:string, chunkIndex:number) => string){
	return streamTransformState<never>((text, chunkIndex) => [transformFunction(text, chunkIndex), null!]);
}

/**Creates a subclass of Stream.Transform from a function that processes one line at a time. */
export function streamTransformState<T>(transformFunction: (text:string, chunkIndex:number, state:T | null) => [output:string, state:T], def:T | null = null){
	return class extends Stream.Transform {
		private _line: string;
		private state: T | null;
		constructor(opts?:TransformOptions){
			super(opts);
			this._line = "";
			this.state = def;
		}
		_transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
			this._line += chunk.toString();
			const lines = this._line.split(/\r?\n/);
			callback(
				null,
				lines
					.slice(0, -1)
					.map(line => line + "\n")
					.map((text, chunkIndex) => {
						const [out, state] = transformFunction(text, chunkIndex, this.state);
						this.state = state;
						return out;
					})
					.join("")
			);
			this._line = lines.at(-1)!;
		}
	};
}

export const LoggerHighlightTransform = streamTransformState<string | null>(
	(line, index, state) => {
		const output = line.match(/^\[\w\]/) || index == 0 ? formatLine(line) : `${state ?? ""}:          ${line}${commandColor}`;
		if(line.match(/^\[(\w)\]/)){
			state = getLogHighlight(line.match(/^\[(\w)\]/)![1]);
		}
		return [output, state];
	}, ANSIEscape.white
);
export function prependTextTransform(text: string | (() => string)){
	return streamTransform((line) => `${text instanceof Function ? text() : text} ${line}`);
}

/**Removes a word from logs. Useful to hide your Windows username.*/
export class CensorKeywordTransform extends Stream.Transform {
	constructor(public keyword:string, public replace:string, opts?:TransformOptions){
		super(opts);
	}
	_transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback):void {
		callback(null, chunk.toString().replaceAll(this.keyword, this.replace));
	}
}



export function askQuestion(query:string):Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise(resolve => rl.question(query, ans => {
		rl.close();
		resolve(ans);
	}));
}

export async function askYesOrNo(query:string):Promise<boolean> {
	const response = await askQuestion(query);
	return response == "y" || response == "yes";
}

/**Copies a directory recursively. */
export function copyDirectory(source:string, destination:string, exclude:string = ""){
	if(path.basename(source) == exclude) return;
	fs.mkdirSync(destination, {recursive: true});
	fs.readdirSync(source, {withFileTypes: true}).forEach(entry => {
		const sourcePath = path.join(source, entry.name);
		const destinationPath = path.join(destination, entry.name);

		entry.isDirectory() ? copyDirectory(sourcePath, destinationPath, exclude) : fs.copyFileSync(sourcePath, destinationPath);
	});
}

export function parseJSONC(data:string) {
	return JSON.parse(data.split("\n")
		.filter(line => !/^[ \t]*\/\//.test(line))
		//Removes lines that start with any amount of whitespaces or tabs and two forward slashes(comments).
		.map(line => line.replace(/\*.*?\*/g, ""))
		//Removes "multiline" comments.
		.join("\n")
	);
}

export function throwIfError(output:SpawnSyncReturns<Buffer>){
	if(output.error) throw output.error;
}

export function stringifyError(err:unknown):string {
	if(err instanceof Error) return err.message;
	else if(typeof err == "string") return err;
	else if(err === undefined) return "undefined";
	else if(err === null) return "null";
	else return "invalid error";
}

export function downloadFile(url:string, outputPath:string){
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

export function formatFileSize(bytes:number):string {
	if(bytes < 1e3) return `${bytes} B`;
	if(bytes < 1e6) return `${(bytes / 1e3).toFixed(2)} KB`;
	if(bytes < 1e9) return `${(bytes / 1e6).toFixed(2)} MB`;
	else return `${(bytes / 1e9).toFixed(2)} GB`;
}

export function resolveRedirect(url:string):Promise<string> {
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