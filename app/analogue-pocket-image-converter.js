/**
	@file webapp that convert between images and Analogue Pocket OS images
	@author Marc Robledo
	@version 1.0
	@copyright 2025-2026 Marc Robledo
	@license
	This file is released under MIT License
	Copyright (c) 2025-2026 Marc Robledo

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


let currentFiles = [];
const SVG_ICONS = {};

const REGEX_IMAGE_MIMETYPE = /^image\/(png|jpeg|gif|webp)$/i;

/* web workers */
const webWorkerImageResizer = new Worker('./app/image-resizer.webworker.js');
webWorkerImageResizer.onmessage = (event) => { // listen for events from the worker
	const imageDataDownscaled=event.data.imageDataDownscaled;
	const responseParameters=event.data.responseParameters;
	if(responseParameters.callbackId === 'replaceImageRawData') {
		const rawData = AnaloguePocketConverter.imageDataToColorRaw(imageDataDownscaled);

		let pocketImage;
		if(responseParameters.library){
			pocketImage=currentFiles[0].entries.find((file) => file instanceof AnaloguePocketImage && file.uid === responseParameters.uid);
		}else{
			pocketImage=currentFiles.find((file) => file instanceof AnaloguePocketImage && file.uid === responseParameters.uid);
		}
		if(!pocketImage){
			alert('failed to find image to replace data');
			throw new Error('failed to find image to replace data');
		}
		const pocketImageDownscaled = new AnaloguePocketImage(pocketImage.name, rawData, pocketImage.library);

		pocketImage.width = pocketImageDownscaled.width;
		pocketImage.height = pocketImageDownscaled.height;
		pocketImage.rawData = pocketImageDownscaled.rawData;

		pocketImage.canvas.width = pocketImageDownscaled.width;
		pocketImage.canvas.height = pocketImageDownscaled.height;
		pocketImage.canvas.getContext('2d').putImageData(imageDataDownscaled, 0, 0);
	}else if(responseParameters.callbackId === 'replaceGridThumbnailPreview') {
		_refreshGridThumbnailPreview(imageDataDownscaled);

	}

};
webWorkerImageResizer.onerror = (event) => { // listen for exceptions from the worker
	alert('image resizer webworker error', 'danger');
};














const appSettings = (function () {
	const LOCAL_STORAGE_KEY = 'analogue-pocket-image-converter-settings';

	let knownGames = [];

	/* load settings */
	const settingsStr = localStorage.getItem(LOCAL_STORAGE_KEY);
	if (settingsStr) {
		try {
			const loadedSettings = JSON.parse(settingsStr);
			if (Array.isArray(loadedSettings.knownGames)) {
				loadedSettings.knownGames.forEach(function (knownGame) {
					if (typeof knownGame === 'object' && typeof knownGame.crc32 === 'number' && typeof knownGame.title === 'string' && typeof knownGame.platform === 'number') {
						knownGames.push({ ...knownGame });
					}
				});
			}
		} catch (e) {
			console.warn('failed to parse settings');
		}
	}

	return {
		addGame: function (crc32, title, platform) {
			const knownGame = this.getGameTitleByCrc32(crc32);
			if (!knownGame) {
				knownGames.push({
					crc32,
					title,
					platform
				});
				return true;
			}
			return false;
		},
		removeGame: function (crc32) {
			const knownGame = knownGames.findIndex((game) => game.crc32 === crc32);
			if (knownGame !== -1) {
				knownGames.splice(knownGame, 1);
				return true;
			}
			return false;
		},
		getAllGames: function () {
			return knownGames;
		},
		getGameTitleByCrc32: function (crc32) {
			return knownGames.find((game) => game.crc32 === crc32);
		},
		reset: function () {
			Object.keys(knownGames).forEach(function (crc32) {
				delete knownGames[crc32];
			});
			this.save();
		},
		save: function () {
			try {
				localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify({
					knownGames
				}));
			} catch (e) {
				console.warn('failed to save settings');
			}
		}
	}
}());



const AnaloguePocketConverter = (function () {
	/* converter for grayscale images (dev icons and banners) */
	const _imageDataToGrayscaleRaw = function (imageData) {
		const rawData = new Uint8Array(imageData.width * imageData.height * 2);
		let saveIndex = 0;
		for (var x = imageData.width - 1; x >= 0; x--) {
			for (var y = 0; y < imageData.height; y++) {
				const pixelIndexFromImageData = (y * imageData.width + x) * 4;
				const brightness = imageData.data[pixelIndexFromImageData];
				rawData[saveIndex] = (~brightness) & 0xff;
				saveIndex += 2;
			}
		}
		return rawData.buffer;
	}
	const _grayscaleRawToImageData = function (rawData, width, height) {
		const binFile = new FileParser(rawData);
		binFile.littleEndian = true;

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		const imageData = ctx.createImageData(width, height);
		const imageSize = width * height;
		let y = 0;
		let x = width - 1;
		for (let i = 0; i < imageSize; i++) {
			const brightness = (~binFile.readU16()) & 0xff;
			const pixelIndex = (y * width + x) * 4;
			imageData.data[pixelIndex] = brightness;
			imageData.data[pixelIndex + 1] = brightness;
			imageData.data[pixelIndex + 2] = brightness;
			imageData.data[pixelIndex + 3] = 255;

			y++;
			if (y === height) {
				y = 0;
				x--;
			}
		}

		return imageData;
	}
	/* converter for color images */
	const _imageDataToColorRaw = function (imageData) {
		const binFile = new FileParser(4 + 2 + 2 + (imageData.width * imageData.height * 4))
		binFile.littleEndian = true;
		binFile.writeU32(0x41504920);
		binFile.writeU16(imageData.width);
		binFile.writeU16(imageData.height);

		for (var x = imageData.width - 1; x >= 0; x--) {
			for (var y = 0; y < imageData.height; y++) {
				const readOffset = (y * imageData.width + x) * 4;
				const r = imageData.data[readOffset + 0];
				const g = imageData.data[readOffset + 1];
				const b = imageData.data[readOffset + 2];
				const a = imageData.data[readOffset + 3];
				binFile.writeU8(b);
				binFile.writeU8(g);
				binFile.writeU8(r);
				binFile.writeU8(a);
			}
		}
		return binFile.getBuffer();
	}
	const _colorRawToImageData = function (rawData) {
		const binFile = new FileParser(rawData);
		binFile.littleEndian = true;
		binFile.seek(4);
		const width = binFile.readU16();
		const height = binFile.readU16();
		if (rawData.byteLength !== (4 + 2 + 2 + (width * height * 4)))
			throw new Error('invalid AP image raw data');

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		const imageData = ctx.createImageData(width, height);
		let y = 0;
		let x = width - 1;
		for (let i = 0; i < binFile.getSize(); i += 4) {
			const b = binFile.readU8();
			const g = binFile.readU8();
			const r = binFile.readU8();
			const a = binFile.readU8();
			const pixelIndex = (y * width + x) * 4;
			imageData.data[pixelIndex] = r;
			imageData.data[pixelIndex + 1] = g;
			imageData.data[pixelIndex + 2] = b;
			imageData.data[pixelIndex + 3] = a;

			y++;
			if (y === height) {
				y = 0;
				x--;
			}
		}

		return imageData;
	}

	return {
		imageDataToGrayscaleRaw: _imageDataToGrayscaleRaw,
		grayscaleRawToImageData: _grayscaleRawToImageData,

		imageDataToColorRaw: _imageDataToColorRaw,
		colorRawToImageData: _colorRawToImageData
	}
}());






const _saveAs = function (fileName, source) {
	let blob;
	if (source instanceof Blob)
		blob = source;
	else if (source instanceof ArrayBuffer)
		blob = new Blob([source], { type: 'application/octet-stream' });
	else
		throw new TypeError('invalid source');

	const blobUrl = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = blobUrl;
	a.download = fileName;
	document.body.appendChild(a);
	a.dispatchEvent(new MouseEvent('click'));
	URL.revokeObjectURL(blobUrl);
	document.body.removeChild(a);
}
const _evtClickExportImage = function (evt) {
	const fileName = this.name + '.png';
	this.canvas.toBlob(function (blob) {
		_saveAs(fileName, blob);
	}, 'image/png');
};
const _evtClickExportImageAsBin = function (evt) {
	_saveAs(this.name + '.bin', this.rawData);
};
class AnaloguePocketImage {
	static nextUniqueId = 0;
	static getNextUid() {
		return AnaloguePocketImage.nextUniqueId++;
	}

	uid;
	name;
	canvas;
	width;
	height;
	library;
	htmlContainer;
	rawData;

	constructor(name, rawData, library) {
		if (typeof name !== 'string')
			throw new TypeError('name must be a string');
		if (!(rawData instanceof ArrayBuffer))
			throw new TypeError('rawData must be a ArrayBuffer');


		this.rawData = rawData;
		/* convert to image */
		let imageData;
		if ((rawData.byteLength % 4 === 0) && (new Uint32Array(rawData))[0] === 0x41504920)
			imageData = AnaloguePocketConverter.colorRawToImageData(rawData);
		else if (rawData.byteLength === (521 * 165 * 2))
			imageData = AnaloguePocketConverter.grayscaleRawToImageData(rawData, 521, 165);
		else if (rawData.byteLength === (36 * 36 * 2))
			imageData = AnaloguePocketConverter.grayscaleRawToImageData(rawData, 36, 36);
		else
			throw new Error('invalid image raw data');



		this.uid = AnaloguePocketImage.getNextUid();
		this.name = name;

		this.width = imageData.width;
		this.height = imageData.height;
		this.canvas = document.createElement('canvas');
		this.canvas.width = this.width;
		this.canvas.height = this.height;
		this.canvas.getContext('2d').putImageData(imageData, 0, 0);

		this.library = library;

		/* build html container */
		const imageType = this.getType();
		const htmlContainer = document.createElement('div');
		htmlContainer.className = 'item item-' + imageType.id;
		htmlContainer.appendChild(document.createElement('div'));
		htmlContainer.appendChild(document.createElement('div'));
		htmlContainer.appendChild(document.createElement('div'));
		htmlContainer.children[0].className = 'item-image';
		htmlContainer.children[1].className = 'item-description';
		htmlContainer.children[2].className = 'item-buttons';
		this.htmlContainer = htmlContainer;

		if(!library){
			this.canvas.addEventListener('mouseover', function (evt) {
				document.getElementById('preview-img').src = this.canvas.toDataURL();
				document.getElementById('preview').style.display = 'block';
			}.bind(this));
			this.canvas.addEventListener('mouseout', function (evt) {
				document.getElementById('preview').style.display = 'none';
			});
		}
		htmlContainer.children[0].appendChild(this.canvas);

		const textTitle = document.createElement('div');
		textTitle.className = 'item-title';
		if (library) {
			textTitle.innerHTML = name;
		} else {
			textTitle.innerHTML = imageType.label;
		}
		htmlContainer.children[1].appendChild(textTitle);
		if (!library) {
			const textInfo = document.createElement('div');
			textInfo.className = 'item-info';
			textInfo.innerHTML = imageType.description;
			htmlContainer.children[1].appendChild(textInfo);
		}

		if (library) {
			const buttonImportImage = document.createElement('button');
			buttonImportImage.innerHTML = `<span>Import image</span> ${SVG_ICONS.upload}`;
			buttonImportImage.addEventListener('click', _evtClickImportLibraryThumbnail.bind(this));
			htmlContainer.children[2].appendChild(buttonImportImage);
		} else {
			const buttonExportImage = document.createElement('button');
			buttonExportImage.innerHTML = `<span>Save as image</span> ${SVG_ICONS.download}`;
			buttonExportImage.addEventListener('click', _evtClickExportImage.bind(this));
			const buttonExportBin = document.createElement('button');
			buttonExportBin.innerHTML = `<span>Save as .bin</span> ${SVG_ICONS.download}`;
			buttonExportBin.addEventListener('click', _evtClickExportImageAsBin.bind(this));
			htmlContainer.children[2].appendChild(buttonExportImage);
			htmlContainer.children[2].appendChild(buttonExportBin);
		}

		this.refreshLabels();
	}

	getType() {
		if (this.width === 36 && this.height === 36)
			return {
				id: 'dev-icon',
				label: 'Developer icon',
				description: '/Cores/&lt;core name&gt;/icon.bin'
			};
		else if (this.width === 521 && this.height === 165)
			return {
				id: 'core-banner',
				label: 'Core banner',
				description: '/Platforms/_images/&lt;platform&gt;.bin'
			};
		else
			return {
				id: 'library-screenshot',
				label: 'Library screenshot',
				description: '/System/Library/Images/&lt;platform&gt;/&lt;crc32&gt;.bin'
			}
	}
	refreshLabels() {
		if (this.getType().id !== 'library-screenshot' || !/^[0-9a-f]{8}$/.test(this.name) || this.knownGame)
			return false;

		const knownGame = appSettings.getGameTitleByCrc32(parseInt(this.name, 16));
		if (knownGame) {
			if (this.library) {
				this.htmlContainer.children[1].children[0].innerHTML = knownGame.title;
			} else {
				this.htmlContainer.children[1].children[0].innerHTML += `: ${knownGame.title}`;
				this.htmlContainer.children[1].children[1].innerHTML = this.htmlContainer.children[1].children[1].innerHTML.replace(/&lt;crc32&gt;/g, this.name);
			}
			this.knownGame = knownGame;
		} else {
			document.getElementById('flash-message-unknown-games').style.display = 'block';
		}
	}

	export() {
		return this.rawData;
	}

	static fromImage(fileName, image, library) {

		if (
			(image.width === 521 && image.height === 165) ||
			(image.width === 36 && image.height === 36)
		) {
			/* dev icon or core banner */
			const canvas = new OffscreenCanvas(image.width, image.height);
			const ctx = canvas.getContext('2d');

			ctx.drawImage(image, 0, 0);
			/* convert to grayscale */
			const imageData = ctx.getImageData(0, 0, image.width, image.height);
			const data = imageData.data;
			for (let i = 0; i < data.length; i += 4) {
				const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
				data[i] = avg;
				data[i + 1] = avg;
				data[i + 2] = avg;
			}
			ctx.putImageData(imageData, 0, 0);

			/* convert image to AP image data */
			const rawData = AnaloguePocketConverter.imageDataToGrayscaleRaw(imageData);
			return new AnaloguePocketImage(fileName, rawData);

		} else {
			/* library grid thumbnail/screenshot */
			const maxWidth = library ? 121 : 344;
			const maxHeight = library ? 109 : 172;
			const downscale = image.width > maxWidth || image.height > maxHeight;
			let finalWidth, finalHeight;
			if (!downscale) {
				finalWidth = image.width;
				finalHeight = image.height;
			} else {
				/* downscale */
				const widthRatio = maxWidth / image.width;
				const heightRatio = maxHeight / image.height;
				const scale = Math.min(widthRatio, heightRatio);
				finalWidth = Math.round(image.width * scale);
				finalHeight = Math.round(image.height * scale);
			}

			const canvas = new OffscreenCanvas(finalWidth, finalHeight);
			const ctx=canvas.getContext('2d');
			ctx.drawImage(image, 0, 0, finalWidth, finalHeight);
			const imageData = ctx.getImageData(0, 0, finalWidth, finalHeight);
			const rawData = AnaloguePocketConverter.imageDataToColorRaw(imageData);
			const pocketImage = new AnaloguePocketImage(fileName, rawData, library);
			/* resize with bilinear filter */
			if(downscale){
				if(!library){
					const originalCanvas=new OffscreenCanvas(image.width, image.height);
					const originalCtx=originalCanvas.getContext('2d');
					originalCtx.drawImage(image, 0, 0);
					const originalImageData=originalCtx.getImageData(0, 0, image.width, image.height);
					webWorkerImageResizer.postMessage({
						imageData: originalImageData,
						maxWidth: maxWidth,
						maxHeight: maxHeight,
						responseParameters: {
							callbackId: 'replaceImageRawData',
							library: !!library,
							uid: library? null : pocketImage.uid //to-do
						}
					});
				}else{
					/* skip for now */
				}
			}

			return pocketImage;
		}
	}
}



const _evtClickExportLibraryThumbnailsAsBin = function (evt) {
	const rawData = this.export();
	_saveAs(this.name + '.bin', rawData);
};
class AnaloguePocketLibraryThumbnails {
	name;
	htmlContainer;
	rawData;
	entries;

	constructor(name, rawData) {
		if (typeof name !== 'string')
			throw new TypeError('name must be a string');
		if (!(rawData instanceof ArrayBuffer))
			throw new TypeError('rawData must be a ArrayBuffer');

		this.name = name;
		this.rawData = rawData;
		this.entries = [];


		/* parse entries */
		const binFile = new FileParser(rawData);
		binFile.littleEndian = true;
		const headerU32 = binFile.readU32();
		const headerU32second = binFile.readU32();

		if (headerU32 !== 0x41544602 || headerU32second !== 0x0000ce1c)
			throw new Error('invalid library thumbnails raw data');

		binFile.seek(8);
		const nEntries = binFile.readU32();
		this.entries = new Array();

		/* parse entries */
		for (var i = 0; i < nEntries; i++) {
			const crc32 = binFile.readU32();
			const offset = binFile.readU32();

			binFile.push();
			binFile.seek(offset);

			if (binFile.readU32() !== 0x41504920)
				throw new Error('invalid library thumbnail header [' + i + ']');

			const width = binFile.readU16();
			const height = binFile.readU16();

			const thumbnailRawData = binFile.getBuffer().slice(offset, offset + (4 + 2 + 2 + (width * height * 4)));

			const entry = {
				index: i,

				crc32,
				offset,
				pocketImage: new AnaloguePocketImage(crc32.toString(16).padStart(8, '0'), thumbnailRawData, this)
			};
			this.entries.push(entry);

			binFile.pop();
		}
		console.log(this.entries);

		/* build html container */
		const htmlContainer = document.createElement('div');
		htmlContainer.className = 'item item-library-thumbnails';
		htmlContainer.appendChild(document.createElement('div'));
		htmlContainer.appendChild(document.createElement('div'));
		htmlContainer.appendChild(document.createElement('div'));
		htmlContainer.children[0].className = 'item-image';
		htmlContainer.children[1].className = 'item-description';
		htmlContainer.children[2].className = 'item-buttons';
		this.htmlContainer = htmlContainer;

		const textTitle = document.createElement('div');
		textTitle.className = 'item-title';
		textTitle.innerHTML = 'Library thumbnails';
		const textInfo = document.createElement('div');
		textInfo.className = 'item-info';
		textInfo.innerHTML = '/System/Library/Images/&lt;platform&gt;_thumbs.bin';
		htmlContainer.children[1].appendChild(textTitle);
		htmlContainer.children[1].appendChild(textInfo);

		const buttonAddEntry = document.createElement('button');
		buttonAddEntry.innerHTML = `<span>Add entry</span> ${SVG_ICONS.plusCircle}`;
		buttonAddEntry.addEventListener('click', _evtClickAddLibraryThumbnailEntry.bind(this));
		htmlContainer.children[2].appendChild(buttonAddEntry);

		const buttonExportBin = document.createElement('button');
		buttonExportBin.innerHTML = `<span>Save as .bin</span> ${SVG_ICONS.download}`;
		buttonExportBin.addEventListener('click', _evtClickExportLibraryThumbnailsAsBin.bind(this));
		htmlContainer.children[2].appendChild(buttonExportBin);
	}

	export() {
		let nextImageOffset = 0x01000c;
		const finalSize = nextImageOffset + this.entries.reduce((acc, entry) => acc + entry.pocketImage.rawData.byteLength, 0);
		const binFile = new FileParser(finalSize);
		binFile.littleEndian = true;
		binFile.writeU32(0x41544602);
		binFile.writeU32(0x0000ce1c);
		binFile.writeU32(this.entries.length);

		for (var i = 0; i < this.entries.length; i++) {
			binFile.writeU32(this.entries[i].crc32);
			binFile.writeU32(nextImageOffset);

			binFile.push();
			binFile.seek(nextImageOffset);
			const rawData=Array.from(new Uint8Array(this.entries[i].pocketImage.export()));
			binFile.writeBytes(rawData);
			nextImageOffset = binFile.getOffset();
			binFile.pop();
		}

		return binFile.getBuffer();
	}
}







const _refreshGridThumbnailPreview = function (imageData) {
	const canvas = document.getElementById('canvas-thumbnail-preview');
	canvas.width = 121;
	canvas.height = 109;
	const ctx=canvas.getContext('2d');
	if(imageData.width === 121 && imageData.height === 109){
		ctx.putImageData(imageData, 0, 0);
	}else{
		const centerX = (121 - imageData.width) / 2;
		const centerY = (109 - imageData.height) / 2;
		const borderHorizontal = new ImageData(imageData.width + 2, 1);
		for(var x=0; x<borderHorizontal.width * 4; x+=4){
			borderHorizontal.data[x + 0] = 255;
			borderHorizontal.data[x + 1] = 255;
			borderHorizontal.data[x + 2] = 255;
			borderHorizontal.data[x + 3] = 255;
		}
		const borderVertical = new ImageData(1, imageData.height + 2);
		for(var y=0; y<borderVertical.height * 4; y++){
			borderVertical.data[y * 4 + 0] = 255;
			borderVertical.data[y * 4 + 1] = 255;
			borderVertical.data[y * 4 + 2] = 255;
			borderVertical.data[y * 4 + 3] = 255;
		}

		ctx.putImageData(borderHorizontal, centerX - 1, centerY - 1);
		ctx.putImageData(borderHorizontal, centerX - 1, centerY + imageData.height);
		ctx.putImageData(borderVertical, centerX - 1, centerY - 1);
		ctx.putImageData(borderVertical, centerX + imageData.width, centerY - 1);
		ctx.putImageData(imageData, centerX, centerY);
	}
}
const _refreshSelectGameNames = function () {
	let filteredGames = appSettings.getAllGames();

	if (/gb_/.test(currentFiles[0].name)) {
		filteredGames = filteredGames.filter(game => game.platform === 0 || game.platform === 1);
	} else if (/gba_/.test(currentFiles[0].name)) {
		filteredGames = filteredGames.filter(game => game.platform === 2);
	} else if (/gg_/.test(currentFiles[0].name)) {
		filteredGames = filteredGames.filter(game => game.platform === 3);
	} else if (/sms_/.test(currentFiles[0].name)) {
		filteredGames = filteredGames.filter(game => game.platform === 4);
	} else if (/ngpc?_/.test(currentFiles[0].name)) {
		filteredGames = filteredGames.filter(game => game.platform === 5 || game.platform === 6);
	} else if (/tg16_/.test(currentFiles[0].name)) {
		filteredGames = filteredGames.filter(game => game.platform === 7);
	} else if (/lynx_/.test(currentFiles[0].name)) {
		filteredGames = filteredGames.filter(game => game.platform === 8);
	}
	//to-do: missing ws and wsc?

	document.getElementById('select-thumbnail-crc32').innerHTML = '';
	filteredGames.sort((a, b) => {
		return a.title.localeCompare(b.title);
	});
	filteredGames.forEach(function (game) {
		const option = document.createElement('option');
		option.value = game.crc32;
		option.disabled = currentLibraryThumbnails.entries.some((entry) => entry.crc32 === game.crc32);
		option.innerHTML = game.title;
		document.getElementById('select-thumbnail-crc32').appendChild(option);
	});

	return filteredGames.length;
}
const _evtClickAddLibraryThumbnailEntry = function (evt) {
	if (!_refreshSelectGameNames()) {
		alert('Import your list.bin file to be able to add new library thumbnails');
		return false;
	}

	document.getElementById('select-thumbnail-crc32').disabled=false;
	document.getElementById('canvas-thumbnail-preview').width = 121;
	document.getElementById('canvas-thumbnail-preview').height = 109;
	document.getElementById('form-thumbnail').reset();
	document.getElementById('form-thumbnail').pocketImage = null;
	document.getElementById('dialog-thumbnail').showModal();
};




const _evtClickImportLibraryThumbnail = function (evt) {
	_refreshSelectGameNames();

	document.getElementById('select-thumbnail-crc32').disabled=true;
	document.getElementById('select-thumbnail-crc32').value = parseInt(this.name, 16);
	if(!document.getElementById('select-thumbnail-crc32').value){
		const option=document.createElement('option');
		option.value=this.name;
		option.innerHTML=this.name;
		document.getElementById('select-thumbnail-crc32').appendChild(option);
		document.getElementById('select-thumbnail-crc32').value=this.name;
	}
	document.getElementById('canvas-thumbnail-preview').width = this.width;
	document.getElementById('canvas-thumbnail-preview').height = this.height;
	document.getElementById('canvas-thumbnail-preview').getContext('2d').putImageData(AnaloguePocketConverter.colorRawToImageData(this.rawData), 0, 0);
	document.getElementById('form-thumbnail').pocketImage = this;
	document.getElementById('dialog-thumbnail').showModal();
};



const _isLibraryThumbnailsOpen = function () {
	return currentFiles.length && currentFiles[0] instanceof AnaloguePocketLibraryThumbnails;
};


window.addEventListener('load', function (evt) {
	SVG_ICONS.plusCircle = document.getElementById('svg-plus-circle').outerHTML;
	SVG_ICONS.download = document.getElementById('svg-download').outerHTML;
	SVG_ICONS.upload = document.getElementById('svg-upload').outerHTML;
	document.getElementById('svg-download').parentElement.remove();

	document.getElementById('btn-import').addEventListener('click', function (evt) {
		document.getElementById('input-file').click();
	});
	document.getElementById('btn-import-start').addEventListener('click', function (evt) {
		document.getElementById('input-file').click();
	});

	document.getElementById('input-file').addEventListener('change', function (evt) {
		let addedFiles = 0;
		Array.from(this.files).forEach(function (file) {
			const fileName = file.name.replace(/\.\w+$/i, '').replace(/\.[^.]+$/, '');
			const mimeType = file.type;

			if (REGEX_IMAGE_MIMETYPE.test(mimeType)) {
				const reader = new FileReader();
				reader.onload = function (evt) {
					const img = new Image();
					img.onload = function () {
						const analoguePocketImage = AnaloguePocketImage.fromImage(fileName, this);
						if (_isLibraryThumbnailsOpen()) {
							currentFiles = [analoguePocketImage];
							document.getElementById('current-files').innerHTML = '';
							document.getElementById('current-library-thumbnails').innerHTML = '';
						} else {
							currentFiles.push(analoguePocketImage);
						}
						document.getElementById('current-files').appendChild(analoguePocketImage.htmlContainer);
					};
					img.src = evt.target.result;
				};
				reader.readAsDataURL(file);
				addedFiles++;

			} else if (mimeType === 'application/octet-stream') {
				const reader = new FileReader();
				reader.onload = function (evt) {
					const binFile = new FileParser(evt.target.result);

					binFile.littleEndian = true;
					const headerU32 = binFile.readU32();
					const headerU32second = binFile.readU32();

					if (headerU32 === 0x41544602 && headerU32second === 0x0000ce1c) {
						/* library *_thumbs.bin */
						currentLibraryThumbnails = new AnaloguePocketLibraryThumbnails(fileName, evt.target.result);
						currentFiles = [currentLibraryThumbnails];
						document.getElementById('current-files').innerHTML = '';
						document.getElementById('current-library-thumbnails').innerHTML = '';
						document.getElementById('current-files').appendChild(currentLibraryThumbnails.htmlContainer);
						currentLibraryThumbnails.entries.forEach(function (entry) {
							document.getElementById('current-library-thumbnails').appendChild(entry.pocketImage.htmlContainer);
						});

					} else if (headerU32 === 0x54414601) {
						/* library list.bin */
						binFile.seek(4);
						const nEntries = binFile.readU32();
						const offsetStartPointers = binFile.readU32();
						const offsetStartEntries = binFile.readU32();
						const entries = new Array();

						binFile.seek(offsetStartPointers);
						/* parse entries */
						let newEntries = 0;
						for (var i = 0; i < nEntries; i++) {
							const offset = binFile.readU32();
							binFile.push();

							binFile.seek(offset);

							const dataSize = binFile.readU16();
							binFile.push();
							binFile.skip(-2);
							const rawData = binFile.readBytes(dataSize);
							binFile.pop();

							const unknownByte = binFile.readU8();
							const platform = binFile.readU8(); //0=GB, 1=GBC, 2=GBA, 3=GG, 4=SMS, 5=NGP, 6=NGPC, 7=TG16, 8=Lynx
							const crc32 = binFile.readU32();
							const unknownData1 = binFile.readU32(8); //seems to be a crc32 of the very first 512 bytes of the ROM
							const unknownData2 = binFile.readU32(8);
							const name = binFile.readString();
							const padTo32 = binFile.readBytes(dataSize - (binFile.getOffset() - offset));

							const entry = {
								index: i,
								offset,

								crc32,
								name,
								platform,

								unknownData1,
								unknownData2,

								rawData
							};
							entries.push(entry);
							if (appSettings.addGame(entry.crc32, entry.name, entry.platform))
								newEntries++;

							binFile.pop();
						}
						console.log(entries);

						document.getElementById('flash-message-unknown-games').style.display = 'none';
						if (newEntries) {
							if (!_isLibraryThumbnailsOpen()) {
								alert('Found ' + newEntries + ' new game titles.\nYou can import your *_thumbs.bin files now.');
							} else {
								alert('Found ' + newEntries + ' new game titles');
							}
							appSettings.save();

							const imagesToRefresh = _isLibraryThumbnailsOpen() ? currentFiles[0].entries.map(entry => entry.pocketImage) : currentFiles;
							imagesToRefresh.forEach(function (file) {
								file.refreshLabels();
							});
						}

					} else {
						/* any other image (dev icon, core banner or library screenshot) */
						const analoguePocketImage = new AnaloguePocketImage(fileName, binFile.getBuffer());
						if (_isLibraryThumbnailsOpen()) {
							currentFiles = [analoguePocketImage];
							document.getElementById('current-files').innerHTML = '';
							document.getElementById('current-library-thumbnails').innerHTML = '';
						} else {
							currentFiles.push(analoguePocketImage);
						}
						document.getElementById('current-files').appendChild(analoguePocketImage.htmlContainer);
					}
				};
				reader.readAsArrayBuffer(file);
				addedFiles++;
			}
		});

		if (addedFiles && document.getElementById('start')) {
			document.getElementById('start').parentElement.removeChild(document.getElementById('start'));
			document.getElementById('app').style.display = 'block';
		}
	});




	document.getElementById('file-thumbnail').addEventListener('change', function (evt) {
		const file = this.files[0];
		const mimeType = file.type;
		const reader = new FileReader();
		if (REGEX_IMAGE_MIMETYPE.test(mimeType)) {
			reader.onload = function (evt) {
				const img = new Image();
				img.onload = function () {
					/* library grid thumbnail/screenshot */
					const maxWidth = 121 - 2;
					const maxHeight = 109 - 2;
					const downscale = img.width > maxWidth || img.height > maxHeight;
					let finalWidth, finalHeight;
					if (!downscale) {
						finalWidth = img.width;
						finalHeight = img.height;
					} else {
						/* downscale */
						const widthRatio = maxWidth / img.width;
						const heightRatio = maxHeight / img.height;
						const scale = Math.min(widthRatio, heightRatio);
						finalWidth = Math.round(img.width * scale);
						finalHeight = Math.round(img.height * scale);
					}

					const tempCanvas=new OffscreenCanvas(maxWidth, maxHeight);
					const tempCtx=tempCanvas.getContext('2d');
					tempCtx.drawImage(img, 0, 0, finalWidth, finalHeight);
					_refreshGridThumbnailPreview(tempCtx.getImageData(0, 0, finalWidth, finalHeight));
					
					/* resize with bilinear filter */
					if(downscale){
						tempCanvas.width = img.width;
						tempCanvas.height = img.height;
						tempCtx.drawImage(img, 0, 0);
						const imageData = tempCtx.getImageData(0, 0, img.width, img.height);
						webWorkerImageResizer.postMessage({
							imageData: imageData,
							maxWidth: maxWidth,
							maxHeight: maxHeight,
							responseParameters: {
								callbackId: 'replaceGridThumbnailPreview'
							}
						});
					}
				};
				img.src = evt.target.result;
			};
			reader.readAsDataURL(file);
		};
	});
	document.getElementById('form-thumbnail').addEventListener('submit', function (evt) {
		const currentPocketImage = this.pocketImage;
		const canvas=document.getElementById('canvas-thumbnail-preview');
		const imageData=canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);

		if(currentPocketImage){
			currentPocketImage.rawData = AnaloguePocketConverter.imageDataToColorRaw(imageData);
			currentPocketImage.width = imageData.width;
			currentPocketImage.height = imageData.height;
			currentPocketImage.canvas.width = imageData.width;
			currentPocketImage.canvas.height = imageData.height;
			currentPocketImage.canvas.getContext('2d').putImageData(imageData, 0, 0);
		}else{
			const crc32 = parseInt(document.getElementById('select-thumbnail-crc32').value);
			const currentLibraryThumbnails = currentFiles[0];
			const newEntry = {
				index: currentLibraryThumbnails.entries.length,

				crc32,
				//offset:null,
				pocketImage: new AnaloguePocketImage(crc32.toString(16).padStart(8, '0'), AnaloguePocketConverter.imageDataToColorRaw(imageData), currentLibraryThumbnails)
			};
			currentLibraryThumbnails.entries.push(newEntry);
			document.getElementById('current-library-thumbnails').appendChild(newEntry.pocketImage.htmlContainer);
		}
	});



	document.getElementById('btn-import-list').addEventListener('click', function (evt) {
		document.getElementById('input-file').click();
	});
});



/* File Parser - by Marc Robledo, https://www.marcrobledo.com */
class FileParser {
	#arrayBuffer;
	#u8array;
	#lastRead;
	#offset;
	#offsetsStack;

	fileName;
	mimeType;
	littleEndian;

	constructor(arrayBuffer, littleEndian, fileName, mimeType) {
		if (typeof arrayBuffer === 'number')
			this.#arrayBuffer = new ArrayBuffer(arrayBuffer);
		else if (arrayBuffer instanceof ArrayBuffer)
			this.#arrayBuffer = arrayBuffer;
		else
			throw new TypeError('no valid ArrayBuffer provided');
		this.#u8array = new Uint8Array(this.#arrayBuffer);
		this.#lastRead = null;
		this.#offset = 0;
		this.#offsetsStack = [];

		this.fileName = typeof fileName === 'string' ? fileName : 'file.bin';
		this.mimeType = typeof mimeType === 'string' ? mimeType : 'application/octet-stream';
		this.littleEndian = !!littleEndian;
	}

	getBuffer() {
		return this.#arrayBuffer;
	}
	getOffset() {
		return this.#offset;
	}

	getSize() {
		return this.#arrayBuffer.byteLength;
	}

	push() {
		this.#offsetsStack.push(this.#offset);
	}
	pop() {
		this.seek(this.#offsetsStack.pop());
	}
	seek(offset) {
		this.#offset = offset;
	}
	skip(nBytes) {
		this.#offset += nBytes;
	}
	isEOF() {
		return !(this.#offset < this.getSize())
	}

	saveAs(fileName) {
		const RUNTIME_ENVIROMENT = (function () {
			if (typeof window === 'object' && typeof window.document === 'object')
				return 'browser';
			else if (typeof WorkerGlobalScope === 'function' && self instanceof WorkerGlobalScope)
				return 'webworker';
			else if (typeof require === 'function' && typeof process === 'object' && typeof process.versions === 'object' && typeof process.versions.node === 'string')
				return 'node';
			else
				return null;
		}());

		if (RUNTIME_ENVIROMENT === 'browser') {
			const fileBlob = new Blob([this.#u8array], { type: this.mimeType });
			const blobUrl = URL.createObjectURL(fileBlob);
			const a = document.createElement('a');
			a.href = blobUrl;
			a.download = fileName;
			document.body.appendChild(a);
			a.dispatchEvent(new MouseEvent('click'));
			URL.revokeObjectURL(blobUrl);
			document.body.removeChild(a);
		} else if (RUNTIME_ENVIROMENT === 'node') {
			nodeFs.writeFileSync(fileName, Buffer.from(this.#u8array.buffer));
		} else {
			throw new Error('invalid runtime environment, can\'t save file');
		}
	}

	getExtension() {
		const ext = this.fileName ? this.fileName.toLowerCase().match(/\.(\w+)$/) : '';
		return ext ? ext[1] : '';
	}
	getName() {
		return this.fileName.replace(new RegExp('\\.' + this.getExtension() + '$', 'i'), '');
	}
	setExtension(newExtension) {
		return (this.fileName = this.getName() + '.' + newExtension);
	}
	setName(newName) {
		return (this.fileName = newName + '.' + this.getExtension());
	}

	readU8() {
		this.#lastRead = this.#u8array[this.#offset++];

		return this.#lastRead
	}
	readU16() {
		if (this.littleEndian)
			this.#lastRead = this.#u8array[this.#offset] + (this.#u8array[this.#offset + 1] << 8);
		else
			this.#lastRead = (this.#u8array[this.#offset] << 8) + this.#u8array[this.#offset + 1];

		this.#offset += 2;
		return this.#lastRead >>> 0
	}
	readU24() {
		if (this.littleEndian)
			this.#lastRead = this.#u8array[this.#offset] + (this.#u8array[this.#offset + 1] << 8) + (this.#u8array[this.#offset + 2] << 16);
		else
			this.#lastRead = (this.#u8array[this.#offset] << 16) + (this.#u8array[this.#offset + 1] << 8) + this.#u8array[this.#offset + 2];

		this.#offset += 3;
		return this.#lastRead >>> 0
	}
	readU32() {
		if (this.littleEndian)
			this.#lastRead = this.#u8array[this.#offset] + (this.#u8array[this.#offset + 1] << 8) + (this.#u8array[this.#offset + 2] << 16) + (this.#u8array[this.#offset + 3] << 24);
		else
			this.#lastRead = (this.#u8array[this.#offset] << 24) + (this.#u8array[this.#offset + 1] << 16) + (this.#u8array[this.#offset + 2] << 8) + this.#u8array[this.#offset + 3];

		this.#offset += 4;
		return this.#lastRead >>> 0
	}
	readBytes(len) {
		this.#lastRead = new Array(len);
		for (var i = 0; i < len; i++) {
			this.#lastRead[i] = this.#u8array[this.#offset + i];
		}

		this.#offset += len;
		return this.#lastRead
	}
	readString(len) {
		let string = '';
		if (typeof len === 'string')
			len = parseInt(len);
		if (typeof len === 'number') {
			for (var i = 0; i < len && (this.#offset + i) < this.fileSize && this.#u8array[this.#offset + i] > 0; i++)
				string += String.fromCharCode(this.#u8array[this.#offset + i]);
		} else {
			len = 0;
			let lastCharCode = 0xff;
			while (lastCharCode > 0x00 && len < 8192) {
				lastCharCode = this.readU8();

				if (lastCharCode > 0x00) {
					string += String.fromCharCode(lastCharCode);
					len++;
				}
			}
		}

		return string;
	}


	writeU8(u8) {
		this.#u8array[this.#offset++] = u8;
	}
	writeU16(u16) {
		if (this.littleEndian) {
			this.#u8array[this.#offset] = u16 & 0xff;
			this.#u8array[this.#offset + 1] = u16 >> 8;
		} else {
			this.#u8array[this.#offset] = u16 >> 8;
			this.#u8array[this.#offset + 1] = u16 & 0xff;
		}

		this.#offset += 2;
	}
	writeU24(u24) {
		if (this.littleEndian) {
			this.#u8array[this.#offset] = u24 & 0x0000ff;
			this.#u8array[this.#offset + 1] = (u24 & 0x00ff00) >> 8;
			this.#u8array[this.#offset + 2] = (u24 & 0xff0000) >> 16;
		} else {
			this.#u8array[this.#offset] = (u24 & 0xff0000) >> 16;
			this.#u8array[this.#offset + 1] = (u24 & 0x00ff00) >> 8;
			this.#u8array[this.#offset + 2] = u24 & 0x0000ff;
		}

		this.#offset += 3;
	}
	writeU32(u32) {
		if (this.littleEndian) {
			this.#u8array[this.#offset] = u32 & 0x000000ff;
			this.#u8array[this.#offset + 1] = (u32 & 0x0000ff00) >> 8;
			this.#u8array[this.#offset + 2] = (u32 & 0x00ff0000) >> 16;
			this.#u8array[this.#offset + 3] = (u32 & 0xff000000) >> 24;
		} else {
			this.#u8array[this.#offset] = (u32 & 0xff000000) >> 24;
			this.#u8array[this.#offset + 1] = (u32 & 0x00ff0000) >> 16;
			this.#u8array[this.#offset + 2] = (u32 & 0x0000ff00) >> 8;
			this.#u8array[this.#offset + 3] = u32 & 0x000000ff;
		}

		this.#offset += 4;
	}
	writeBytes(a) {
		for (var i = 0; i < a.length; i++)
			this.#u8array[this.#offset + i] = a[i]

		this.#offset += a.length;
	}
	writeString(str, len) {
		len = len || str.length;
		for (var i = 0; i < str.length && i < len; i++)
			this.#u8array[this.#offset + i] = str.charCodeAt(i);

		for (; i < len; i++)
			this.#u8array[this.#offset + i] = 0x00;

		this.#offset += len;
	}

	/* crc32() {
		FileParser.CRC32_TABLE = FileParser.CRC32_TABLE || (function () {
			var c, crcTable = [];
			for (var n = 0; n < 256; n++) {
				c = n;
				for (var k = 0; k < 8; k++)
					c = ((c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1));
				crcTable[n] = c;
			}
			return crcTable;
		}());


		let crc = 0 ^ (-1);
		for (var i = 0; i < this.getSize(); i++)
			crc = (crc >>> 8) ^ FileParser.CRC32_TABLE[(crc ^ this.#u8array[i]) & 0xff];

		return ((crc ^ (-1)) >>> 0);
	} */
}
