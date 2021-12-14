/*

ZXServer

MIT License

Copyright (c) 2021 Juan Jose Luna Espinosa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/

var fs = require( 'fs' );
var path = require( 'path' );
var pathJoin = path.join;
var express = require( 'express' );
var http = require( 'http' );
var net = require( 'net' );
var { pipeline } = require( 'stream' );


//    *** Server Parameters ***

// CHANGE PARAMETERS HERE:

/*
const httpServerPort = 8091;
const gameServerPort = 8092;
const fileServerPort = 8083;
*/

const httpServerPort = null;
const gameServerPort = 8092;
const fileServerPort = 8083;

//const MAX_UPLOAD_FILE_SIZE = 0;
const MAX_UPLOAD_FILE_SIZE = 8 * 1024 * 1024;

// Maximum: 2^32 -1
const maxRooms = 10;


//   *** Server Parameters end ***





// *** Common variables ***

var version = "v1.0";

// Set app title
var title = "ZXServer " + version;
process.title = title;
console.log( title );

var singleByteBuffer = Buffer.alloc( 1 );
var singleByteBuffer2 = Buffer.alloc( 1 );
var uint16Buffer = Buffer.alloc( 2 );
var uint16Buffer2 = Buffer.alloc( 2 );
var uint32Buffer = Buffer.alloc( 4 );

var app, httpServer;
var gameServer;
var fileServer;

// *** Common variables end ***

// Termination signal
process.on( "SIGINT", function() {

	console.log( " SIGINT Signal Received, shutting down." );
	process.exit( 0 );

} );


// Create HTTP server
if ( httpServerPort ) {

	app = express();
	httpServer = http.Server( app );
	app.use( "/", express.static( "./public" ) );

	httpServer.listen( httpServerPort, function () { console.log( "Server started." ); } );

}


// *************** Create TCP/IP file server ***************

const MAX_PATH_SIZE = 255;
const MAX_FILE_SIZE = Math.pow( 2, 32 ) - 1;
const MAX_FILES_IN_A_DIRECTORY = 65535;

const FILE_CLIENT_MAX_COMMAND = 0x05;

const FILE_ORDERING_ALPHABETICAL = 0x00;
const FILE_ORDERING_ALPHABETICAL_INVERTED = 0x01;
const FILE_ORDERING_BY_SIZE_DECREASING = 0x02;
const FILE_ORDERING_BY_SIZE_INCREASING = 0x03;
const FILE_ORDERING_BY_DATE_DECREASING = 0x04;
const FILE_ORDERING_BY_DATE_INCREASING = 0x05;
const FILE_ORDERING_MAX = FILE_ORDERING_BY_DATE_INCREASING;

// File transfer processing type
// None:
const FILE_TRANSFER_PROCESSING_TYPE_NONE = 0;
// Add +3DOS header if the file doesn't have already:
const FILE_TRANSFER_PROCESSING_TYPE_ADD_P3DOS_HEADER = 1;
// Remove +3DOS header if the file has it:
const FILE_TRANSFER_PROCESSING_TYPE_REMOVE_P3DOS_HEADER = 2;

var fileServerBasePath = pathJoin( __dirname, "public" );

// Create TCP/IP File Server
if ( fileServerPort ) {

	fileServer = net.createServer( function( socket ) {

		console.log( "Client connected to file server." );

		var fileClient = {
			socket: socket,
			isIdle: true,
			currentCommand: null,
			parsedPathParameters: false,
			parsedPath: false,
			parsedSearchString: false,
			path: "",
			fullDirPath: "",
			searchString: "",
			orderingMethod: 0,
			parsedFirstUIntBytes: 0,
			parsedSecondUIntBytes: 0,
			firstUInt: 0,
			secondUInt: 0,
			isExecutingCommand: false,
			isUploading: false,
			uploadFileHandle: null,
			uploadSize: 0,
			uploadToMemory: false,
			uploadBuffer: null,
			bytesUploaded: 0,
			isWriting: false,
			fileTranferProcessingType: FILE_TRANSFER_PROCESSING_TYPE_NONE
		};

		socket.on( 'data', function ( data ) {
/*
			console.log( "Got data from file client. Size: " + data.length );

			console.log( "Data: " );
			for ( var i = 0; i < data.length; i ++ ) console.log( data[ i] );
*/
			parseFileClientData( fileClient, data );

		} );

		socket.on( 'error', function ( error ) {

			console.log( "File client socket error: " + error );

		} );

		socket.on( 'close', function ( hadError ) {

			if ( hadError ) {

				console.log( "File Client was unexpectedly disconnected." );

			}
			else  {

				console.log( "File Client disconnected." );

			}

		} );

	} );

	fileServer.listen( fileServerPort );

}

// ********* File Server functions *********

function parseFileClientData( fileClient, data ) {
//debug console.log( "BYTES LENGTH ****: " + data.length );
	for ( var i = 0; i < data.length; i ++ ) {

		var b = data[ i ];
//debug console.log( "BYTE PARSE 0: " + b );
		var isLastByte = i === data.length - 1;

		if ( fileClient.isIdle ) {
//debug console.log( "BYTE PARSE 1" );
			if ( b > FILE_CLIENT_MAX_COMMAND ) {
				console.log( "File client error: unrecognized command: " + b );
				fileClient.socket.end();
				break;
			}

			switch ( b ) {

				case 0x04:

					// Command "disconnect"

					fileClient.socket.end();
					return;

				case 0x05:

					// Command "ping"

					if ( isLastByte ) {

						singleByteBuffer[ 0 ] = 0x00;
						fileClient.socket.write( singleByteBuffer );

					}
					else {

						fileClientSentTooMuchData( fileClient );
						return;
					}

					break;

				default:

					fileClient.currentCommand = b;
					fileClient.isIdle = false;
					break;

			}

		}
		else if ( ! fileClient.parsedPathParameters ) {
//debug console.log( "BYTE PARSE 2" );
			// Parse path, search string and ordering byte parameters

			if ( ! parsePathParameters( fileClient, b ) ) {
				console.log( "Error: File Client sent incomprehensible data." );
				fileClient.socket.end();
				return;
			}

		}
		else if ( fileClient.isUploading ) {
//debug console.log( "BYTE PARSE 3" );
			handleUpload( fileClient, b );

		}
		else {
//debug console.log( "BYTE PARSE 4" );
			if ( fileClient.isExecutingCommand ) {

				fileClientSentTooMuchData( fileClient );
				return;

			}

			var finishedCommand = false;

			switch ( fileClient.currentCommand ) {

				case 0x00:

					// Command "listFiles"

					finishedCommand = parseListFilesCommand( fileClient, b );

					break;

				case 0x01:

					// Command "getFileNameAndSize"

					finishedCommand = parseGetFileNameAndSizeCommand( fileClient, b );

					break;

				case 0x02:

					// Command "downloadFile"

					finishedCommand = parseDownloadFileCommand( fileClient, b );

					break;

				case 0x03:

					// Command "uploadFile"

					finishedCommand = parseUploadFileCommand( fileClient, b );

					break;

				default:
					console.log( "File Client error: Unknown command: " + fileClient.currentCommand );
					fileClient.socket.end();
					return;
			}

			if ( finishedCommand ) {

				if ( ! isLastByte ) {

					fileClientSentTooMuchData( fileClient );
					return;

				}

			}

		}

	}

}

function resetFileClient( fileClient ) {

	fileClient.isIdle = true;
	fileClient.currentCommand = null;
	fileClient.parsedPathParameters = false;
	fileClient.parsedPath = false;
	fileClient.parsedSearchString = false;
	fileClient.path = "";
	fileClient.fullDirPath = "";
	fileClient.searchString = "";
	fileClient.orderingMethod = 0;
	fileClient.isExecutingCommand = false;
	fileClient.isUploading = false;
	fileClient.uploadFileHandle = null;
	fileClient.uploadSize = 0;
	fileClient.uploadToMemory = false;
	fileClient.uploadBuffer = null;
	fileClient.isWriting = false;
	fileClient.bytesUploaded = 0;
	fileClient.fileTranferProcessingType = FILE_TRANSFER_PROCESSING_TYPE_NONE;

}

function parsePathParameters( fileClient, theByte ) {

	// Returns boolean success (true) or error
//debug console.log( "PARSE PARAMS 0" );
	if ( ! fileClient.parsedPath ) {
//debug console.log( "PARSE PARAMS 1" );
		// Parse path

		if ( theByte === 0 ) {

			fileClient.parsedPath = true;

			// Upload file command
			if ( fileClient.currentCommand === 0x03 ) fileClient.parsedPathParameters = true;

			return true;

		}

		if ( fileClient.path.length >= 254 ) return false;

		var theCharacter = String.fromCharCode( theByte );
		if ( ! isFileNameChar( theByte ) ) return false;

		fileClient.path += theCharacter;

	}
	else {
//debug console.log( "PARSE PARAMS 2" );
		// Rest of commands

		if ( ! fileClient.parsedSearchString ) {

			// Parse search string

			if ( theByte === 0 ) {

				fileClient.parsedSearchString = true;
				return true;

			}

			var theCharacter = String.fromCharCode( theByte );
			if ( ! isReadableChar( theByte ) ) return false;

			fileClient.searchString += theCharacter;

		}
		else {
//debug console.log( "PARSE PARAMS 3" );
			// Parse ordering byte
//debug console.log( "DEBUG ORDERING: " + theByte );
			if ( theByte > FILE_ORDERING_MAX ) return false;

			fileClient.orderingMethod = theByte;
			fileClient.parsedPathParameters = true;

		}

	}

	return true;

}

function parseListFilesCommand( fileClient, theByte ) {

	// Returns true if client input finished parsing and command was executed.

	if ( fileClient.parsedFirstUIntBytes === 0 ) {

		fileClient.firstUInt = theByte;
		fileClient.parsedFirstUIntBytes = 1;

	}
	else if ( fileClient.parsedFirstUIntBytes === 1 ) {

		fileClient.firstUInt |= theByte << 8;
		fileClient.parsedFirstUIntBytes = 2;

	}
	else if ( fileClient.parsedSecondUIntBytes === 0 ) {

		fileClient.secondUInt = theByte;
		fileClient.parsedSecondUIntBytes = 1;

	}
	else if ( fileClient.parsedSecondUIntBytes === 1 ) {

		fileClient.secondUInt |= theByte << 8;
		fileClient.parsedSecondUIntBytes = 2;

	}
	else {

		fileClient.parsedFirstUIntBytes = 0;
		fileClient.parsedSecondUIntBytes = 0;
		var maxBytesFileName = theByte;
		executeListFilesCommand( fileClient, maxBytesFileName );

		return true;

	}

	return false;

}

function parseGetFileNameAndSizeCommand( fileClient, theByte ) {

	// Returns true if client input finished parsing and command was executed.

	if ( fileClient.parsedFirstUIntBytes === 0 ) {

		fileClient.firstUInt = theByte;
		fileClient.parsedFirstUIntBytes = 1;

	}
	else if ( fileClient.parsedFirstUIntBytes === 1 ) {

		fileClient.firstUInt |= theByte << 8;

		fileClient.parsedFirstUIntBytes = 0;
		fileClient.parsedSecondUIntBytes = 0;
		executeGetFileNameAndSizeCommand( fileClient );

		return true;

	}

	return false;

}

function parseDownloadFileCommand( fileClient, theByte ) {

	// Returns true if client input finished parsing and command was executed.

	if ( fileClient.parsedFirstUIntBytes === 0 ) {

		fileClient.firstUInt = theByte;
		fileClient.parsedFirstUIntBytes = 1;

	}
	else if ( fileClient.parsedFirstUIntBytes === 1 ) {

		fileClient.firstUInt |= theByte << 8;

		fileClient.parsedFirstUIntBytes = 2;

	}

	else {

		fileClient.fileTranferProcessingType = theByte;

		fileClient.parsedFirstUIntBytes = 0;
		fileClient.parsedSecondUIntBytes = 0;
		executeDownloadFileCommand( fileClient );

		return true;

	}


	return false;

}

function parseUploadFileCommand( fileClient, theByte ) {

	// Returns true if client input finished parsing and command was executed.

	if ( fileClient.parsedFirstUIntBytes === 0 ) {

		fileClient.firstUInt = theByte;
		fileClient.parsedFirstUIntBytes = 1;

	}
	else if ( fileClient.parsedFirstUIntBytes === 1 ) {

		fileClient.firstUInt |= theByte << 8;
		fileClient.parsedFirstUIntBytes = 2;

	}
	else if ( fileClient.parsedFirstUIntBytes === 2 ) {

		fileClient.firstUInt |= theByte << 16;
		fileClient.parsedFirstUIntBytes = 3;

	}
	else if ( fileClient.parsedFirstUIntBytes === 3 ) {

		fileClient.firstUInt |= theByte << 24;

		fileClient.parsedFirstUIntBytes = 4;

	}
	else {

		fileClient.fileTranferProcessingType = theByte;

		fileClient.parsedFirstUIntBytes = 0;
		fileClient.parsedSecondUIntBytes = 0;

		executeUploadFileCommand( fileClient );

	}

	return false;

}

function fileClientSentTooMuchData( fileClient ) {

	console.log( "Error: File Client sent too much data." );

	if ( fileClient ) fileClient.socket.end();

}

function executeListFilesCommand( fileClient, maxBytesFileName ) {

	fileClient.isExecutingCommand = true;
	getDirectoryEntries( fileClient.path, fileClient.searchString, fileClient.orderingMethod, ( entries ) => {

		if ( entries === null ) {

			// "Path not found" byte response
			singleByteBuffer[ 0 ] = 0x01;
			fileClient.socket.write( singleByteBuffer );
			resetFileClient( fileClient );
			return;

		}

		// "OK" byte response
		singleByteBuffer[ 0 ] = 0x00;
		fileClient.socket.write( singleByteBuffer );

		// Send number of total entries
		fillUint16Buffer( entries.length );
		fileClient.socket.write( uint16Buffer );

		// Send number of returned entries

		var offset = fileClient.firstUInt;
		var maxEntries = fileClient.secondUInt;

		var returnedEntries = 0;
		if ( offset < entries.length ) returnedEntries = Math.min( maxEntries, entries.length - offset );

		fillUint16Buffer( returnedEntries );
		fileClient.socket.write( uint16Buffer );

		// Send the file entries

		var entryBuffer = null;
		if ( returnedEntries > 0 ) entryBuffer = Buffer.alloc( 9 + maxBytesFileName );
		for ( var i = 0; i < returnedEntries; i ++ ) {

			var entry = entries[ offset + i ];

			var p = 0;

			// Entry type: '>' = Directory, ' ' = Regular file.
			entryBuffer[ p++ ] = entry.isDirectory ? 62 : 32;

			// Entry name
			var j = 0;
			for ( var jl = Math.min( maxBytesFileName, entry.nameWithoutExtension.length ); j < jl; j ++ ) {

				entryBuffer[ p++ ] = entry.nameWithoutExtension.charCodeAt( j );


			}

			// Pad name with spaces
			for ( ; j < maxBytesFileName; j ++ ) {

				entryBuffer[ p++ ] = 0;

			}

			// 'Shortened file name' flag
			var shortenedFileName = maxBytesFileName < entry.nameWithoutExtension.length;
			entryBuffer[ p++ ] = shortenedFileName ? 46 : 32;

			// Extension
			entryBuffer[ p++ ] = entry.extension.charCodeAt( 0 );
			entryBuffer[ p++ ] = entry.extension.charCodeAt( 1 );
			entryBuffer[ p++ ] = entry.extension.charCodeAt( 2 );

			// File size
			fillUint32Buffer( entry.size );
			entryBuffer[ p++ ] = uint32Buffer[ 0 ];
			entryBuffer[ p++ ] = uint32Buffer[ 1 ];
			entryBuffer[ p++ ] = uint32Buffer[ 2 ];
			entryBuffer[ p ] = uint32Buffer[ 3 ];

			fileClient.socket.write( entryBuffer );

		}

		resetFileClient( fileClient );

	} );

}

function executeGetFileNameAndSizeCommand( fileClient ) {

	fileClient.isExecutingCommand = true;
	getDirectoryEntries( fileClient.path, fileClient.searchString, fileClient.orderingMethod, ( entries ) => {

		if ( entries === null ) {

			// "Path not found" byte response
			singleByteBuffer[ 0 ] = 0x01;
			fileClient.socket.write( singleByteBuffer );
			resetFileClient( fileClient );
			return;

		}

		var offset = fileClient.firstUInt;

		if ( offset >= entries.length ) {

			// "Entry index out of bounds" byte response
			singleByteBuffer[ 0 ] = 0x02;
			fileClient.socket.write( singleByteBuffer );
			resetFileClient( fileClient );
			return;

		}

		var entry = entries[ offset ];

		// "OK" byte response
		singleByteBuffer[ 0 ] = 0x00;
		fileClient.socket.write( singleByteBuffer );

		// Directory or regular file flag: '>' = Directory, ' ' = Regular file.
		singleByteBuffer[ 0 ] = entry.isDirectory ? 62 : 32;
		fileClient.socket.write( singleByteBuffer );

		// File name
		for ( var i = 0, il = Math.min( entry.name.length, 254 ); i < il; i ++ ) {

			var asciiCharacter = entry.name.charCodeAt( i );
			// Readable char or '?'
			asciiCharacter = isReadableChar( asciiCharacter ) ? asciiCharacter : 63;

			singleByteBuffer[ 0 ] = asciiCharacter;
			fileClient.socket.write( singleByteBuffer );

		}
		singleByteBuffer[ 0 ] = 0;
		fileClient.socket.write( singleByteBuffer );

		// File size
		fillUint32Buffer( entry.size );
		fileClient.socket.write( uint32Buffer );

		resetFileClient( fileClient );


	} );

}

function executeDownloadFileCommand( fileClient ) {

	fileClient.isExecutingCommand = true;
	getDirectoryEntries( fileClient.path, fileClient.searchString, fileClient.orderingMethod, ( entries ) => {

		if ( entries === null ) {

			// "Path not found" byte response
			singleByteBuffer[ 0 ] = 0x01;
			fileClient.socket.write( singleByteBuffer );
			resetFileClient( fileClient );
			return;

		}

		var offset = fileClient.firstUInt;

		if ( offset >= entries.length ) {

			// "Entry index out of bounds" byte response
			singleByteBuffer[ 0 ] = 0x02;
			fileClient.socket.write( singleByteBuffer );
			resetFileClient( fileClient );
			return;

		}

		var entry = entries[ offset ];

		if ( entry.isDirectory ) {

			// "Entry is directory, can't download" byte response
			singleByteBuffer[ 0 ] = 0x03;
			fileClient.socket.write( singleByteBuffer );
			resetFileClient( fileClient );
			return;

		}

		// "OK" byte response
		singleByteBuffer[ 0 ] = 0x00;
		fileClient.socket.write( singleByteBuffer );

		if ( fileClient.fileTranferProcessingType === FILE_TRANSFER_PROCESSING_TYPE_ADD_P3DOS_HEADER || fileClient.fileTranferProcessingType === FILE_TRANSFER_PROCESSING_TYPE_REMOVE_P3DOS_HEADER ) {

			fs.readFile( entry.fullPath, ( err, data ) => {

				if ( err ) {

					console.log( "Error transferring file contents to file client. File path: " + entry.fullPath );
					return;

				}

				const hasHeader = hasPlus3DOSHeader( data );

				var fileSize = data.length;

				var preData = null;
				if ( fileClient.fileTranferProcessingType === FILE_TRANSFER_PROCESSING_TYPE_ADD_P3DOS_HEADER ) {

					preData = Buffer.alloc( 7 );

					if ( hasHeader ) {

						// Set +3BASIC header
						const basicHeaderOffset = 15;
						for ( var i = 0; i < 7; i ++ ) preData[ i ] = data[ basicHeaderOffset + i ];

						// Remove +3DOS header from file contents
						data = data.slice( 128 );
						fileSize = data.length;

					}
					else {

						// Set default +3BASIC header
						var ext = getFilenameExtension( entry.fullPath ).toLowerCase();
						var b0 = ( fileSize <= 65536 ) ? ( fileSize & 0x00000FF ) : 0;
						var b1 = ( fileSize <= 65536 ) ? ( ( fileSize & 0x000FF00 ) >> 8 ) : 0;
						preData[ 0 ] = ext === 'bas' ? 0 : 3;
						preData[ 1 ] = b0;
						preData[ 2 ] = b1;
						preData[ 3 ] = 0x00;
						preData[ 4 ] = ext === 'scr' ? 0x40 : 0x80;
						preData[ 5 ] = 0x00;
						preData[ 6 ] = 0x00;

					}

				}

				if ( fileSize === 0 ) {

					console.log( "Error transferring file contents to file client: File size is 0. File path: " + entry.fullPath );
					return;

				}

				// Send file size
				fillUint32Buffer( fileSize );
				fileClient.socket.write( uint32Buffer );

				console.log( "Sending file contents to file client, fileSize = " + fileSize + " bytes." );

				if ( preData !== null ) data = Buffer.concat( [ preData, data ] );

				// Send data
				fileClient.socket.write( data );

				console.log( "Finished sending file contents to file client." );

				resetFileClient( fileClient );

			} );

		}
		else {

			// Send file size
			fillUint32Buffer( entry.size );
			fileClient.socket.write( uint32Buffer );

			console.log( "Sending file contents to file client, size = " + entry.size + " bytes." );

			// Send data
			var readStream = fs.createReadStream( entry.fullPath );
			pipeline( readStream, fileClient.socket, ( error ) => {

				if ( error ) console.log( "Error transferring file contents to file client. File path: " + entry.fullPath );
				else console.log( "Finished sending file contents to file client." );

				resetFileClient( fileClient );

			} );

		}

	} );

}

function hasPlus3DOSHeader( data ) {

	return ( data.length > 128 ) &&
	( String.fromCharCode( data[ 0 ] ) === 'P' ) &&
	( String.fromCharCode( data[ 1 ] ) === 'L' ) &&
	( String.fromCharCode( data[ 2 ] ) === 'U' ) &&
	( String.fromCharCode( data[ 3 ] ) === 'S' ) &&
	( String.fromCharCode( data[ 4 ] ) === '3' ) &&
	( String.fromCharCode( data[ 5 ] ) === 'D' ) &&
	( String.fromCharCode( data[ 6 ] ) === 'O' ) &&
	( String.fromCharCode( data[ 7 ] ) === 'S' );

}

function executeUploadFileCommand( fileClient ) {

	fileClient.isExecutingCommand = true;

	if ( fileClient.firstUInt === 0 ) {

		// "File length is 0" byte response
		singleByteBuffer[ 0 ] = 0x02;
		fileClient.socket.write( singleByteBuffer );
		resetFileClient( fileClient );
		return;

	}

	if ( fileClient.firstUInt > MAX_UPLOAD_FILE_SIZE ) {

		// "File length exceeds limit" byte response
		singleByteBuffer[ 0 ] = 0x03;
		fileClient.socket.write( singleByteBuffer );
		resetFileClient( fileClient );
		return;

	}

	fileClient.fullDirPath = pathJoin( fileServerBasePath, fileClient.path );

	if ( ! fileClient.fullDirPath.startsWith( fileServerBasePath ) ) {

		// Tried directory traversal
		return;

	}

	// TODO check if file exists, return error 0x01

	fs.open( fileClient.fullDirPath, 'w', ( err, fd ) => {

		if ( err ) {

			// "Open for write error" byte response
			singleByteBuffer[ 0 ] = 0x04;
			fileClient.socket.write( singleByteBuffer );
			resetFileClient( fileClient );

			console.log( "Error opening file for writing (client upload), size = " + fileClient.firstUInt + " bytes, path = '" + fileClient.path + "'" );

			return;

		}

		fileClient.uploadFileHandle = fd;

		// "OK" byte response
		singleByteBuffer[ 0 ] = 0x00;
		fileClient.socket.write( singleByteBuffer );

		fileClient.isUploading = true;
		fileClient.uploadToMemory = false;

		console.log( "Client is uploading file with size = " + fileClient.firstUInt + " bytes." );

		fileClient.uploadSize = fileClient.firstUInt;

		if ( fileClient.fileTranferProcessingType === FILE_TRANSFER_PROCESSING_TYPE_ADD_P3DOS_HEADER ) {

			fileClient.uploadSize += 7;
			fileClient.uploadToMemory = true;
		}

	} );

}

function handleUpload( fileClient, theByte ) {

	if ( fileClient.uploadToMemory ) handleUploadToMemory( fileClient, theByte );
	else handleUploadToFile( fileClient, theByte );

}

function handleUploadToFile( fileClient, theByte ) {

	const tempBuffer = Buffer.alloc( 1 );
	tempBuffer[ 0 ] = theByte;

	if ( fileClient.isWriting || fileClient.uploadFileHandle === null ) {

		// Enqueue byte

		if ( fileClient.uploadBuffer === null ) {

			fileClient.uploadBuffer = tempBuffer;

		}
		else {

			if ( fileClient.uploadBuffer.length + 1 > fileClient.uploadSize ) {

				fileClientSentTooMuchData();
				return;

			}

			fileClient.uploadBuffer = Buffer.concat( [ fileClient.uploadBuffer, tempBuffer ] );

		}

	}
	else {

		// Write data

		if ( fileClient.uploadBuffer !== null ) {

			fileClient.uploadBuffer = Buffer.concat( [ fileClient.uploadBuffer, tempBuffer ] );
			fileClient.isWriting = true;
			fileClient.bytesUploaded += fileClient.uploadBuffer.length;
			if ( fileClient.bytesUploaded > fileClient.uploadSize ) {

				fileClientSentTooMuchData();
				return;

			}
			fs.write( fileClient.uploadFileHandle, fileClient.uploadBuffer, handleWrite );
			fileClient.uploadBuffer = null;

		}
		else {

			fileClient.isWriting = true;
			fileClient.bytesUploaded ++;
			if ( fileClient.bytesUploaded > fileClient.uploadSize ) {

				fileClientSentTooMuchData();
				return;

			}
			fs.write( fileClient.uploadFileHandle, tempBuffer, handleWrite );

		}

	}

	function handleWrite( err, bytesWritten, buffer ) {

		if ( err ) {

			console.log( "Error writing file upload from file client: " + err );
			fileClient.isUploading = false;
			return;

		}

		if ( bytesWritten !== buffer.length ) {

			console.log( "Error writing file upload from file client, not all bytes were written." );
			fileClient.isUploading = false;
			return;

		}

		fileClient.isWriting = false;

		if ( fileClient.uploadBuffer !== null ) {

			fileClient.isWriting = true;
			fileClient.bytesUploaded += fileClient.uploadBuffer.length;
			if ( fileClient.bytesUploaded > fileClient.uploadSize ) {

				fileClientSentTooMuchData();
				return;

			}
			fs.write( fileClient.uploadFileHandle, fileClient.uploadBuffer, handleWrite );
			fileClient.uploadBuffer = null;

		}
		else if ( fileClient.bytesUploaded === fileClient.uploadSize ) {

			fs.close( fileClient.uploadFileHandle, () => {

				if ( err ) {

					console.log( "Error closing file upload from file client." );
					return;

				}

				// "OK" byte response and end of command
				singleByteBuffer[ 0 ] = 0x00;
				fileClient.socket.write( singleByteBuffer );

				processFileUploaded( fileClient, () => {

					resetFileClient( fileClient );

					console.log( "Finished receiving file contents from file client." );
				} );

			} );

		}

	}

}

function handleUploadToMemory( fileClient, theByte ) {

	if ( fileClient.bytesUploaded + 1 > fileClient.uploadSize ) {

		fileClientSentTooMuchData();
		return;

	}

	if ( fileClient.uploadBuffer === null ) {

		fileClient.uploadBuffer = Buffer.alloc( fileClient.uploadSize );

	}

	fileClient.uploadBuffer[ fileClient.bytesUploaded ++ ] = theByte;

	if ( fileClient.bytesUploaded === fileClient.uploadSize ) {

		// Write the file

		fs.write( fileClient.uploadFileHandle, fileClient.uploadBuffer, ( err ) => {

			if ( err ) console.log( "Error writing to disk uploaded file to memory. File path: " + fileClient.fullDirPath );

			fileClient.uploadBuffer = null;

			fs.close( fileClient.uploadFileHandle, () => {

				if ( err ) {

					console.log( "Error closing file upload to memory from file client." );
					return;

				}

				// "OK" byte response and end of command
				singleByteBuffer[ 0 ] = 0x00;
				fileClient.socket.write( singleByteBuffer );

				processFileUploaded( fileClient, () => {

					resetFileClient( fileClient );

					console.log( "Finished receiving file contents from file client." );

				} );

			} );

		} );

	}

}

function processFileUploaded( fileClient, onProcessed ) {

	if ( fileClient.fileTranferProcessingType === FILE_TRANSFER_PROCESSING_TYPE_ADD_P3DOS_HEADER ) {

		reconstructFilePlus3DOSHeader( fileClient.fullDirPath, onProcessed );

	}
	else if ( fileClient.fileTranferProcessingType === FILE_TRANSFER_PROCESSING_TYPE_REMOVE_P3DOS_HEADER ) {

		removeFilePlus3DOSHeader( fileClient.fullDirPath, onProcessed );

	}
	else onProcessed();

}

function reconstructFilePlus3DOSHeader( fullDirPath, onDone ) {

	fs.readFile( fullDirPath, ( err, data ) => {

		if ( err ) {

			console.log( "Error processing +3DOS header on uploaded file while loading. File path: " + entry.fullPath );
			onDone();
			return;

		}

		var fileSize = data.length;

		if ( fileSize < 8 ) {

			console.log( "Error processing +3DOS header on uploaded file. It is too small. File path: " + entry.fullPath );
			onDone();
			return;
		}

		// Get +3BASIC header from start of file
		var basicHeader = Buffer.alloc( 7 );
		for ( var i = 0; i < 7; i ++ ) basicHeader[ i ] = data[ i ];
		data = data.slice( 7 );
		fileSize -= 7;

		// Construct +3DOS header
		var header = Buffer.alloc( 128 );
		header[ 0 ] = 0x50;
		header[ 1 ] = 0x4C;
		header[ 2 ] = 0x55;
		header[ 3 ] = 0x53;
		header[ 4 ] = 0x33;
		header[ 5 ] = 0x44;
		header[ 6 ] = 0x4F;
		header[ 7 ] = 0x53;
		header[ 8 ] = 0x1A;
		header[ 9 ] = 0x01;
		header[ 10 ] = 0x00;

		var p = 11;

		fileSize += 128;
		header[ p ++ ] = fileSize & 0x0000000FF;
		header[ p ++ ] = ( fileSize & 0x00000FF00 ) >> 8;
		header[ p ++ ] = ( fileSize & 0x000FF0000 ) >> 16;
		header[ p ++ ] = ( fileSize & 0x0FF000000 ) >> 24;

		for ( var i = 0; i < 7; i ++ ) header[ p ++ ] = basicHeader[ i ];

		for ( ; p < 127; p ++ ) header[ p ] = 0;

		var checksum = 0;
		for ( var i = 0; i < 127; i ++ ) checksum = ( checksum + header[ i ] ) % 256;
		header[ 127 ] = checksum;

		data = Buffer.concat( [ header, data ] );

		fs.writeFile( fullDirPath, data, ( err ) => {

			if ( err ) console.log( "Error processing +3DOS header on uploaded file while writing. File path: " + entry.fullPath );

			onDone();

		} );

	} );
}

function removeFilePlus3DOSHeader( fullDirPath, onDone ) {

	fs.readFile( fullDirPath, ( err, data ) => {

		if ( err ) {

			console.log( "Error removing +3DOS header on uploaded file while loading. File path: " + entry.fullPath );
			onDone();
			return;

		}

		if ( ! hasPlus3DOSHeader( data ) ) {

			onDone();
			return;

		}

		var fileSize = data.length;

		if ( fileSize < 129 ) {

			console.log( "Error removing +3DOS header on uploaded file. It is too small. File path: " + entry.fullPath );
			onDone();
			return;

		}

		data = data.slice( data.length - 128 );

		fs.writeFile( fullDirPath, data, ( err ) => {

			if ( err ) console.log( "Error removing +3DOS header on uploaded file while writing. File path: " + entry.fullPath );

			onDone();
			return;

		} );

	} );

}


function getDirectoryEntries( directoryPath, searchString, orderingMethod, callback ) {

	var fullDirPath = pathJoin( fileServerBasePath, directoryPath );

	if ( ! fullDirPath.startsWith( fileServerBasePath ) ) {

		// Tried directory traversal
		callback( null );
		return;

	}

	fs.readdir( fullDirPath, ( err, files ) => {

		if ( err ) {

			callback( null );
			return;

		}


		var entries = [ ];

		if ( files.length === 0 ) {

			entries.push( getTwoPointsDirEntry() );
			callback( entries );
			return;

		}
		else processFile( 0 );

		function processFile( index ) {

			if ( index >= files.length ) {

				if ( entries.length > MAX_FILES_IN_A_DIRECTORY ) {

					console.log( "Error: A directory contains more file entries than " + MAX_FILES_IN_A_DIRECTORY + ". Please limit the amount of files and directories to that limit. Path: " + directoryPath );
					callback( null );
					return;

				}

				orderEntries();

				var upDir = pathJoin( "./", directoryPath );
				if ( ! ( upDir === "/" || upDir === "./" ) ) {

					entries.unshift( getTwoPointsDirEntry() );

				}

				callback( entries );
				return;

			}
			else {

				var fileName = files[ index ];
				var filePath = pathJoin( directoryPath, fileName );
				if ( filePath.length > MAX_PATH_SIZE ) {

					console.log( "Error: A file entry name contains more than " + MAX_PATH_SIZE + " characters. Please trim the file names to that limit. Path: " + filePath );
					callback( null );
					return;

				}

				var fullPath = pathJoin( fileServerBasePath, filePath );

				if ( ! fullPath.startsWith( fileServerBasePath ) ) {

					// Attempted directory crossing
					callback( null );
					return;

				}

				fs.stat( fullPath, ( err, stats ) => {

					if ( err ) {

						callback( null );
						return;

					}

					var isDirectory = stats.isDirectory();

					if ( ! isDirectory && ! stats.isFile() ) {

						console.log( "Error: A file is not a directory nor a regular file. Path: " + entry.fullPath );
						callback( null );
						return;

					}

					var fileSizeBytes = isDirectory ? 0 : stats.size;

					if ( fileSizeBytes > MAX_FILE_SIZE ) {

						console.log( "Error: A file size is bigger than the limit of " + MAX_FILE_SIZE + ". Please remove that file. File path: " + entry.fullPath );
						fileSizeBytes = 0;

						callback( null );
						return;

					}

					var extension = getFilenameExtension( fileName );

					var fileNameWithoutExtension = fileName;
					if ( extension.length > 0 ) {

						fileNameWithoutExtension = fileNameWithoutExtension.substring( 0, fileNameWithoutExtension.length - extension.length - 1 );

						extension = extension.substring( 0, Math.min( 3, extension.length ) );
					}

					while ( extension.length < 3 ) extension += ' ';

					entries.push( {
						fullPath: fullPath,
						name: fileName,
						nameWithoutExtension: fileNameWithoutExtension,
						extension: extension,
						isDirectory: isDirectory,
						size: fileSizeBytes,
						creationDate: stats.birthtimeMs
					} );

					processFile( index + 1 );

				} );

			}

		}

		function orderEntries() {

			var orderFunc = null;
			switch ( orderingMethod ) {

				case FILE_ORDERING_ALPHABETICAL:
					orderFunc = function( a, b ) {
						if ( a.isDirectory !== b.isDirectory ) return a.isDirectory ? -1 : 1;
						return a.name < b.name ? -1 : ( a.name === b.name ? 0 : 1 );
					};
					break;
				case FILE_ORDERING_ALPHABETICAL_INVERTED:
					orderFunc = function( a, b ) {
						if ( a.isDirectory !== b.isDirectory ) return a.isDirectory ? -1 : 1;
						return a.name > b.name ? -1 : ( a.name === b.name ? 0 : 1 );
					};
					break;
				case FILE_ORDERING_BY_SIZE_DECREASING:
					orderFunc = function( a, b ) {
						if ( a.isDirectory !== b.isDirectory ) return a.isDirectory ? -1 : 1;
						return a.size > b.size ? -1 : ( a.size === b.size ? 0 : 1 );
					};
					break;
				case FILE_ORDERING_BY_SIZE_INCREASING:
					orderFunc = function( a, b ) {
						if ( a.isDirectory !== b.isDirectory ) return a.isDirectory ? -1 : 1;
						return a.size < b.size ? -1 : ( a.size === b.size ? 0 : 1 );
					};
					break;
				case FILE_ORDERING_BY_DATE_DECREASING:
					orderFunc = function( a, b ) {
						if ( a.isDirectory !== b.isDirectory ) return a.isDirectory ? -1 : 1;
						return a.creationDate > b.creationDate ? -1 : ( a.creationDate === b.creationDate ? 0 : 1 );
					};
					break;
				case FILE_ORDERING_BY_DATE_INCREASING:
					orderFunc = function( a, b ) {
						if ( a.isDirectory !== b.isDirectory ) return a.isDirectory ? -1 : 1;
						return a.creationDate < b.creationDate ? -1 : ( a.creationDate === b.creationDate ? 0 : 1 );
					};
					break;
				default:
					console.log( "Internal error: unknown ordering method." );
					return;
			}

			entries.sort( orderFunc );

		}

	} );

	function getTwoPointsDirEntry() {

		return {
			fullPath: null,
			name: "..",
			nameWithoutExtension: "..",
			extension: "",
			isDirectory: true,
			size: 0
		};

	}

}

// *************** Create TCP/IP game server ***************

const APP_ID_LENGTH = 32;
const ROOM_NAME_LENGTH = 32;

var rooms = [];
var clients = [];

var roomInfoBuffer = Buffer.alloc( ROOM_NAME_LENGTH + 5 );

const CLIENT_STATE_IDLE = 0;
const CLIENT_STATE_RECEIVING = 1;

const ROOM_FLAGS_HAS_TIMER = 1;
const ROOM_FLAGS_ALLOWS_PULL_DATA = 2;

const readableCharRegExp = RegExp( /^[a-z0-9!"#$%&'()*+,.\/:;<=>?@\[\] ^_`{|}~-]*$/i );
const fileNameCharRegExp = RegExp( /^[a-z0-9!"#$%&'()*+,.\/:;<=>?@\[\] ^_`{|}~-]*$/i );

gameServer = net.createServer( function( socket ) {

	console.log( "Client connected to game server." );

	var client = {
		socket: socket,
		room: null,
		state: CLIENT_STATE_IDLE,
		currentCommand: -1,
		currentData: null,
		id: 0
	};
	clients.push( client );

	socket.on( 'data', function ( data ) {

		//console.log( "new data length: " + data.length );

		var numBytesParameters = 0;

		switch ( client.state ) {

			case CLIENT_STATE_IDLE:

				var command = data[ 0 ];

				numBytesParameters = getCommandParametersSizeBytes( client, command );

				if ( numBytesParameters === null ) {

					console.log( "Game client sent unrecognized command: " + command );
					removeGameClient( client );
					return;

				}

				if ( data.length > 1 + numBytesParameters ) {

					console.log( "Game client sent too much data, disconnecting (State was idle). : command: " + command + ", data length: " + data.length + ", expected parameter length: " + numBytesParameters );
					removeGameClient( client );
					return;

				}

				if ( data.length === 1 + numBytesParameters ) {

					executeCommand( client, command, data );

				}
				else {

					client.currentCommand = command;
					client.currentData = data;
					client.state = CLIENT_STATE_RECEIVING;

				}

				break;

			case CLIENT_STATE_RECEIVING:

				numBytesParameters = getCommandParametersSizeBytes( client, client.currentCommand );
				if ( numBytesParameters === 0 ) {

					console.log( "Internal error: Unrecognized command: " + command );
					removeGameClient( client );
					return;

				}

				if ( client.currentData.length + data.length > 1 + numBytesParameters ) {

					console.log( "Game client sent too much data, disconnecting (State was receiving)." );
					removeGameClient( client );
					return;

				}

				client.currentData = Buffer.concat( [ client.currentData, data ] );

				if ( client.currentData.length === 1 + numBytesParameters ) {

					const command = client.currentCommand;
					const parameters = client.currentData;

					client.currentCommand = -1;
					client.currentData = null;
					client.state = CLIENT_STATE_IDLE;

					executeCommand( client, command, parameters );

				}

				break;

		}

	} );

	socket.on( 'error', function ( error ) {

		console.log( "Game client socket error: " + error );

	} );

	socket.on( 'close', function ( hadError ) {

		removeGameClient( client );

		if ( hadError ) {

			console.log( "Game client was unexpectedly disconnected." );

		}
		else  {

			console.log( "Game client disconnected." );

		}

	} );

} );
gameServer.listen( gameServerPort );


// ********* Game Server functions *********

function removeGameClient( client ) {

	removeClientFromRoom( client );

	var i = clients.indexOf( client );

	if ( i >= 0 ) clients.splice( i, 1 );

	client.socket.end();

}

function createRoom( creator, appId, roomName, maxClients, dataByteCount, timeout, flags ) {

	if ( creator.room ) {

		removeClientFromRoom( client );

	}

	creator.room = {
		clients: [ creator ],
		currentClientData: [ null ],
		currentNumClientsHaveData: 0,
		creator: creator,
		timeoutID: undefined,
		assignedIds: Buffer.alloc( 255 ),
		timerMs: new Date().getTime(),
		appId: appId,
		roomName: roomName,
		maxClients: maxClients,
		dataByteCount: dataByteCount,
		timeout: timeout,
		flags: flags
	};

	for ( var i = 0; i < 255; i ++ ) creator.room.assignedIds[ i ] = i === 0 ? 1 : 0;

	creator.id = 0;

	creator.room.timeoutID = setTimeout( roomTimeoutHandler, creator.room.timeout * 20, creator.room );

	return creator.room;

}

var roomTimeoutHandler = sendDataToRoom;

function getRoom( roomNameBuffer ) {

	for ( var r = 0, rl = rooms.length; r < rl; r ++ ) {

		if ( idEquals( rooms[ r ].roomName, roomNameBuffer ) ) return rooms[ r ];

	}

	return null;

}

function removeRoom( room ) {

	var i = rooms.indexOf( room );
	if ( i >= 0 ) {

		clearTimeout( room.timeoutID );

		for ( var j = 0, jl = room.clients.length; j < jl; j ++ ) {

			room.clients[ j ].room = null;
			room.clients[ j ].id = 0;

		}

		room.clients = [];

		rooms.splice( i, 1 );

		var s = idToString( room.roomName );
		console.log( "Removed room " + ( s ? "named <" + s + ">" : "with no name.") );

	}

}

function removeClientFromRoom( client ) {

	if ( ! client.room ) return;

	if ( client.room.creator === client ) {

		removeRoom( client.room );

	}
	else {

		var i = client.room.clients.indexOf( client );

		if ( i < 0 ) return;

		var hasData = client.room.currentClientData[ i ] !== null;

		client.room.clients.splice( i, 1 );
		client.room.currentClientData.splice( i, 1 );
		if ( hasData ) client.room.currentNumClientsHaveData = Math.max( 0, client.room.currentNumClientsHaveData - 1 );
		client.room.assignedIds[ client.id ] = 0;
		client.room = null;
		client.id = 0;

	}

}

function insertClientInRoom( client, room ) {

	if ( client.room === room ) return true;

	if ( room.clients.length >= room.maxClients ) return false;

	if ( client.room ) removeClientFromRoom( client );

	var id = 0;
	while ( id < 256 ) {

		if ( room.assignedIds[ id ] === 0 ) break;

		id ++;

	}

	if ( id >= 256 ) {

		console.log( "Internal error: no id available for client." );
		return false;

	}

	room.clients.push( client );
	room.currentClientData.push( null );
	client.room = room;
	client.id = id;
	room.assignedIds[ id ] = 1;

	return true;

}

function sanitizeId( id ) {

	var isZero = false;
	for ( var i = 0, il = id.length; i < il; i ++ ) {

		if ( isZero ) {

			id[ i ] = 0;

		}
		else {

			var c = id[ i ];
			if ( ! isReadableChar( c ) ) {

				id[ i ] = 0;
				isZero = true;

			}

		}

	}

}

function idEquals( id1, id2 ) {

	if ( id1.length !== id2.length ) return false;

 	for ( var i = 0, il = id1.length; i < il; i ++ ) {

		if ( id1[ i ] !== id2[ i ] ) return false;

	}

	return true;

}

function idToString( idBuffer ) {

	var s = "";
	for ( var i = 0, il = idBuffer.length; i < il; i ++ ) {

		var c = idBuffer[ i ];

		if ( c === 0 ) {

			if ( i === 0 ) return null;

			break;

		}
		else {

			if ( isReadableChar( c ) ) {

				s += String.fromCharCode( c );

			}

		}

	}

	return s;

}

function getCommandParametersSizeBytes( client, commandByte ) {

	// Returns the numbers of bytes expected from the client as parameters, after the command byte.

	switch ( commandByte ) {

		case 0x00:

			// Command: listRooms

			return APP_ID_LENGTH;

		case 0x01:

			// Command: createRoom

			return APP_ID_LENGTH + ROOM_NAME_LENGTH + 4;

		case 0x02:

			// Command: enterRoom

			return ROOM_NAME_LENGTH;

		case 0x03:

			// Command: leaveRoom

			return 0;

		case 0x04:

			// Command: disconnect

			return 0;

		case 0x05:

			// Command: applicationData

			if ( client.room ) return client.room.dataByteCount;

			return 0;

		case 0x06:

			// Command: pullData

			return 0;

		case 0x07:

			// Command: resetTimer

			return 0;

		case 0x08:

			// Command: getUniqueId

			return 0;

		case 0x09:

			// Command: ping

			return 0;

		case 0x0A:

			// Command: rand

			return 0;

		default:

			// Unrecognized command

			return null;

	}

}

function executeCommand( client, command, data ) {

	//console.log( "*** executeCommand: " + command );

	switch( command ) {

		case 0x00:

			// Command: listRooms

			commandListRooms( client, data );

			break;

		case 0x01:

			// Command: createRoom

			commandCreateRoom( client, data );

			break;

		case 0x02:

			// Command: enterRoom

			commandEnterRoom( client, data );

			break;

		case 0x03:

			// Command: leaveRoom

			commandLeaveRoom( client );

			break;

		case 0x04:

			// Command: disconnect

			removeGameClient( client );

			break;

		case 0x05:

			// Command: applicationData

			commandApplicationData( client, data );

			break;

		case 0x06:

			// Command: pullData

			commandApplicationData( client );

			break;

		case 0x07:

			commandResetTimer( client );

			break;

		case 0x08:

			// Command: getUniqueId

			commandGetUniqueId( client );

			break;

		case 0x09:

			// Command: ping

			commandPing( client );

			break;

		case 0x0A:

			// Command: rand

			commandRand( client );

			break;

		default:

			// Unrecognized command

			console.log( "Unrecognized command: " + command );
			removeGameClient( client );

			return;
	}

}

function commandListRooms( client, data ) {

	var appIdBuffer = Buffer.alloc( APP_ID_LENGTH );
	var p = 1;
	for ( var i = 0; i < APP_ID_LENGTH; i ++ ) appIdBuffer[ i ] = data[ p++ ];
	sanitizeId( appIdBuffer );

	var numRooms = 0;
	for ( var i = 0, il = rooms.length; i < il; i ++ ) {

		var room = rooms[ i ];
		if ( idEquals( room.appId, appIdBuffer ) ) numRooms ++;

	}

	fillUint32Buffer( numRooms );
	client.socket.write( uint32Buffer );

	for ( var i = 0, il = rooms.length; i < il; i ++ ) {

		var room = rooms[ i ];

		if ( idEquals( room.appId, appIdBuffer ) ) {

			var p = 0;
			// Room name
			for ( var j = 0; j < ROOM_NAME_LENGTH; j ++ ) roomInfoBuffer[ p++ ] = room.roomName[ j ];
			// Current client count in room
			roomInfoBuffer[ p++ ] = room.clients.length;
			// Max clients in room
			roomInfoBuffer[ p++ ] = room.maxClients;
			// Number of bytes per client transmission
			roomInfoBuffer[ p++ ] = room.dataByteCount;
			// Room timeout in 1/50s of second
			roomInfoBuffer[ p++ ] = room.timeout;
			// Room flags
			roomInfoBuffer[ p++ ] = room.flags;

			client.socket.write( roomInfoBuffer );

		}

	}

}

function commandCreateRoom( client, data ) {

	var appIdBuffer = Buffer.alloc( APP_ID_LENGTH );
	var roomNameBuffer = Buffer.alloc( ROOM_NAME_LENGTH );
	var p = 1;
	for ( var i = 0; i < APP_ID_LENGTH; i ++ ) appIdBuffer[ i ] = data[ p++ ];
	for ( var i = 0; i < ROOM_NAME_LENGTH; i ++ ) roomNameBuffer[ i ] = data[ p++ ];
	var maxClients = data[ p++ ];
	var dataByteCount = data[ p++ ];
	var timeout = data[ p++ ];
	var flags = data[ p++ ];

	sanitizeId( appIdBuffer );
	sanitizeId( roomNameBuffer );

	var appId = idToString( appIdBuffer );
	var roomName = idToString( roomNameBuffer );

	// Check max rooms
	if ( rooms.length >= maxRooms ) {

		console.log( "Warning: Client tried to create room but max. number of rooms was reached (max rooms = " + maxRooms + ")" );
		singleByteBuffer[ 0 ] = 0x01;
		client.socket.write( singleByteBuffer );
		return;

	}

	// Check room name doesn't exist
	if ( getRoom( roomNameBuffer ) ) {

		console.log( "Warning: Client tried to create room but room name already exists (room name = <" + roomName + ">)" );
		singleByteBuffer[ 0 ] = 0x02;
		client.socket.write( singleByteBuffer );
		return;

	}

	// Check parameters
	if ( maxClients < 2 ) {
		console.log( "Error: Client tried to create room with < 2 max clients (max clients = " + maxClients + ")" );
		singleByteBuffer[ 0 ] = 0x03;
		client.socket.write( singleByteBuffer );
		return;
	}

	if ( dataByteCount === 0 ) {
		console.log( "Error: Client tried to create room with dataByteCount = 0" );
		singleByteBuffer[ 0 ] = 0x04;
		client.socket.write( singleByteBuffer );
		return;
	}

	if ( timeout === 0 ) {
		console.log( "Error: Client tried to create room with timeout = 0" );
		singleByteBuffer[ 0 ] = 0x05;
		client.socket.write( singleByteBuffer );
		return;
	}

	if ( flags & 0xFC ) {
		console.log( "Error: Invalid room flags for this version of protocol. Flags: " + flags );
		singleByteBuffer[ 0 ] = 0x06;
		client.socket.write( singleByteBuffer );
		return;
	}

	rooms.push( createRoom( client, appIdBuffer, roomNameBuffer, maxClients, dataByteCount, timeout, flags ) );

	singleByteBuffer[ 0 ] = 0x00;
	client.socket.write( singleByteBuffer );

	console.log( "Created room. App Id " + ( appId ? ": \"" + appId + "\"": "is empty" ) + ". Room name " + ( roomName ? ": \"" + roomName + "\"": "is empty" ) + ". Max clients: " + maxClients + ". DataByteCount: " + dataByteCount + ". Timeout: " + timeout + ". Flags: " + flags );

}

function commandEnterRoom( client, data ) {

	var roomNameBuffer = Buffer.alloc( ROOM_NAME_LENGTH );
	var p = 1;
	for ( var i = 0; i < ROOM_NAME_LENGTH; i ++ ) roomNameBuffer[ i ] = data[ p++ ];
	sanitizeId( roomNameBuffer );
	var roomName = idToString( roomNameBuffer );
	var room = getRoom( roomNameBuffer );
	if ( ! room ) {

		console.log( "Warning: Client tried to enter room but room not found (room name = <" + roomName + ">)" );
		singleByteBuffer[ 0 ] = 0x01;
		client.socket.write( singleByteBuffer );
		return;

	}

	if ( ! insertClientInRoom( client, room ) ) {

		console.log( "Warning: Client tried to enter room but max. number of clients in the room was reached (max clients = " + room.maxClients + ")" );
		singleByteBuffer[ 0 ] = 0x02;
		client.socket.write( singleByteBuffer );
		return;

	}

	singleByteBuffer[ 0 ] = 0x00;
	client.socket.write( singleByteBuffer );

	console.log( "Client entered in room. Room name " + ( roomName ? ": \"" + roomName + "\"": "is empty" ) + ". Num clients in room: " + room.clients.length );

}

function commandLeaveRoom( client ) {

	var room = client.room;

	if ( ! room ) {

		singleByteBuffer[ 0 ] = 0x01;
		client.socket.write( singleByteBuffer );
		return;

	}

	removeClientFromRoom( client );

	singleByteBuffer[ 0 ] = 0x00;
	client.socket.write( singleByteBuffer );
	console.log( "Client leaved room. Num clients in room: " + room.clients.length );

}

function commandApplicationData( client, data ) {

	var room = client.room;

	if ( ! room ) {

		singleByteBuffer[ 0 ] = 0x00;
		client.socket.write( singleByteBuffer );
		return;

	}

	var i = room.clients.indexOf( client );
	if ( i < 0 ) {

		removeGameClient( client );
		console.log( "Internal error: client is not in the room." );
		return;

	}

	if ( room.currentClientData[ i ] !== null ) {

		removeGameClient( client );
		console.log( "Client sent too much data." );
		return;

	}

	if ( data ) {

		var clientData = Buffer.alloc( data.length - 1 );
		for ( var j = 0, jl = data.length - 1; j < jl; j ++ ) clientData[ j ] = data[ j + 1 ];
		room.currentClientData[ i ] = clientData;

	}
	else if ( ! ( room.flags & ROOM_FLAGS_ALLOWS_PULL_DATA ) ) {

		// Room doesn't allow "pullData" command, kick client out

		removeGameClient( client );
		return;

	}
	else room.currentClientData[ i ] = true;

	room.currentNumClientsHaveData ++;


	if ( room.currentNumClientsHaveData >= room.clients.length ) {

		clearTimeout( room.timeoutID );

		sendDataToRoom( room );

	}

}

function sendDataToRoom( room ) {

	// Gather data from clients in room in variable 'allData'

	var allData = null;
	var numClientDataBlocks = 0;
	var numClientsOnlyPullData = 0;
	var roomHasBeenRemoved = false;

	for ( var j = 0, jl = room.clients.length; j < jl; j ++ ) {

		var clientData2 = room.currentClientData[ j ];

		if ( clientData2 === true ) {

			// Client pulled data without sending

			numClientsOnlyPullData ++;
			room.currentClientData[ j ] = null;

		}
		else if ( clientData2 != null ) {

			// Client sent data

			if ( allData === null ) {

				allData = clientData2;

			}
			else {

				allData = Buffer.concat( [ allData, clientData2 ] );

			}

			numClientDataBlocks ++;
			room.currentClientData[ j ] = null;

		}
		else {

			// Client has timed out, kick him out

			if ( room.clients[ j ] === room.creator ) roomHasBeenRemoved = true;

			removeGameClient( room.clients[ j ] );

			if ( roomHasBeenRemoved ) {

				// No data will be sent, the room has been removed.
				break;

			}

		}

	}

	// Send the data to clients

	singleByteBuffer[ 0 ] = numClientDataBlocks;
	for ( var j = 0, jl = room.clients.length; j < jl; j ++ ) {

		var peer = room.clients[ j ];

		// Send number of blocks
		peer.socket.write( singleByteBuffer );

		// Send timer
		if ( room.flags & ROOM_FLAGS_HAS_TIMER ) {

			fillUint32Buffer( new Date().getTime() - room.timerMs );
			peer.socket.write( uint32Buffer );

		}

		// Send extra byte if ROOM_FLAGS_ALLOWS_PULL_DATA is enabled
		if ( room.flags & ROOM_FLAGS_ALLOWS_PULL_DATA ) {

			singleByteBuffer2[ 0 ] = numClientsOnlyPullData;
			peer.socket.write( singleByteBuffer2 );

		}

		// Send blocks
		if ( numClientDataBlocks > 0 ) peer.socket.write( allData );

	}

	room.currentNumClientsHaveData = 0;

	// Reset timeout
	if ( ( ! roomHasBeenRemoved ) && ( ( numClientDataBlocks > 0 ) || ( numClientsOnlyPullData > 0 ) ) ) {

		room.timeoutID = setTimeout( roomTimeoutHandler, room.timeout * 20, room );

	}

}

function commandResetTimer( client ) {

	if ( ! client.room ) {

		singleByteBuffer[ 0 ] = 0x01;
		client.socket.write( singleByteBuffer );
		return;

	}

	if ( ! ( client.room.flags & ROOM_FLAGS_ALLOWS_PULL_DATA ) ) {

		singleByteBuffer[ 0 ] = 0x02;
		client.socket.write( singleByteBuffer );
		return;

	}

	client.room.timerMs = new Date().getTime();

	singleByteBuffer[ 0 ] = 0x00;
	client.socket.write( singleByteBuffer );

}

function commandGetUniqueId( client ) {

	if ( ! client.room ) {

		singleByteBuffer[ 0 ] = 0x01;
		client.socket.write( singleByteBuffer );
		return;

	}

	singleByteBuffer[ 0 ] = 0x00;
	client.socket.write( singleByteBuffer );

	singleByteBuffer[ 0 ] = client.id;
	client.socket.write( singleByteBuffer );

}

function commandPing( client ) {

	singleByteBuffer[ 0 ] = 0x00;
	client.socket.write( singleByteBuffer );

}

function commandRand( client ) {

	singleByteBuffer[ 0 ] = Math.floor( Math.random() * 256 );
	client.socket.write( singleByteBuffer );

}

// ********* Game Server functions end *********


// ********* Common functions *********

function fillUint16Buffer( value ) {

	uint16Buffer[ 0 ] = value & 0x000000FF;
	uint16Buffer[ 1 ] = ( value & 0x0000FF00 ) >> 8;

}

function fillUint16Buffer2( value ) {

	uint16Buffer2[ 0 ] = value & 0x000000FF;
	uint16Buffer2[ 1 ] = ( value & 0x0000FF00 ) >> 8;

}

function fillUint32Buffer( value ) {

	uint32Buffer[ 0 ] = value & 0x000000FF;
	uint32Buffer[ 1 ] = ( value & 0x0000FF00 ) >> 8;
	uint32Buffer[ 2 ] = ( value & 0x00FF0000 ) >> 16;
	uint32Buffer[ 3 ] = ( value & 0xFF000000 ) >> 24;

}

function isReadableChar( c ) {

	return readableCharRegExp.test( String.fromCharCode( c ) );

}

function isFileNameChar( c ) {

	return fileNameCharRegExp.test( String.fromCharCode( c ) );

}

function getFilenameExtension( path ) {

    pathLastIndexOfDot = path.lastIndexOf( "." );

    if ( pathLastIndexOfDot > 0 && path.length > pathLastIndexOfDot + 1) {

        return path.substring( pathLastIndexOfDot + 1 );

    }
    else return "";

}

// ********* Common functions end *********
