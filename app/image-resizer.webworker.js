/**
 * Web worker adaptation of pure JS image bilinear rescaler from https://stackoverflow.com/a/19144434
 *
 * by Marc Robledo
 * Released under no license
 * 
 * Usage:
 * 
 * const webWorkerImageResizer = new Worker('image-resizer.webworker.js');
 * webWorkerImageResizer.onmessage = event => { // listen for events from the worker
 *    const scale=event.data.scale;
 *    const finalWidth=event.data.finalWidth;
 *    const finalHeight=event.data.finalHeight;
 *    const imageDataDownscaled=event.data.imageDataDownscaled;
 * 
 *    const canvas=document.createElement('canvas');
 *    canvas.width=finalWidth;
 *    canvas.height=finalHeight;
 *    const ctx=canvas.getContext('2d');
 *    ctx.putImageData(imageDataDownscaled, 0, 0);
 * 
 *    document.body.appendChild(canvas);
 * };
 * webWorkerImageResizer.onerror = event => { // listen for exceptions from the worker
 *    console.error('error while bilinear resizing: ', event.message);
 * };
 * 
 * //examples
 * const myImageData=myCanvas.getContext('2d').getImageData(0, 0, myCanvas.width, myCanvas.height)
 * // downscale to 256x256 max
 * webWorkerImageResizer.postMessage({
 *    imageData: myImageData,
 *    maxWidth: 256,
 *    maxHeight: 256
 * });
 * // upscale to 1.5x
 * webWorkerImageResizer.postMessage({
 *    imageData: myImageData,
 *    scale: 1.5
 * });
 */

const bilinearRescaleImageData = function (imageDataSource, scale) {
	if (scale === 1)
		return imageDataSource;
	else if (scale === 0)
		throw new Error('scale value cannot be zero');

	const sqScale = scale * scale; // square scale = area of source pixel within target
	const sourceWidth = imageDataSource.width; // source image width
	const sourceHeight = imageDataSource.height; // source image height
	//const targetWidth = Math.floor(sourceWidth * scale); // target image width
	//const targetHeight = Math.floor(sourceHeight * scale); // target image height
	const targetWidth = Math.round(sourceWidth * scale); // target image width
	const targetHeight = Math.round(sourceHeight * scale); // target image height

	var sourceX = 0, sourceY = 0, sourceIndex = 0; // source x,y, index within source array
	var targetX = 0, targetY = 0, targetIndex = 0; // target x,y, x,y index within target array
	var targetRoundedX = 0, targetRoundedY = 0; // rounded tx, ty
	var w = 0, nw = 0, wx = 0, nwx = 0, wy = 0, nwy = 0; // weight / next weight x / y
	// weight is weight of current source point within target.
	// next weight is weight of current source point within next target's point.


	const sourceBuffer = imageDataSource.data; // source buffer 8 bit rgba
	const targetBuffer = new Float32Array(3 * targetWidth * targetHeight); // target buffer Float32 rgb
	var sR = 0, sG = 0, sB = 0; // source's current point r,g,b
	/* untested !
	var sA = 0;  //source alpha  */

	for (sourceY = 0; sourceY < sourceHeight; sourceY++) {
		targetY = sourceY * scale; // y src position within target
		targetRoundedY = 0 | targetY;	 // rounded : target pixel's y
		const yIndex = 3 * targetRoundedY * targetWidth;  // line index within target array

		const crossY = (targetRoundedY != (0 | targetY + scale)); // does scaled px cross its current px bottom border ?
		if (crossY) { // if pixel is crossing botton target pixel
			wy = (targetRoundedY + 1 - targetY); // weight of point within target pixel
			nwy = (targetY + scale - targetRoundedY - 1); // ... within y+1 target pixel
		}

		for (sourceX = 0; sourceX < sourceWidth; sourceX++, sourceIndex += 4) {
			targetX = sourceX * scale; // x src position within target
			targetRoundedX = 0 | targetX;	// rounded : target pixel's x
			targetIndex = yIndex + targetRoundedX * 3; // target pixel index within target array
			const crossX = (targetRoundedX != (0 | targetX + scale)); // does scaled px cross its current px right border ?
			if (crossX) { // if pixel is crossing target pixel's right
				wx = (targetRoundedX + 1 - targetX); // weight of point within target pixel
				nwx = (targetX + scale - targetRoundedX - 1); // ... within x+1 target pixel
			}
			sR = sourceBuffer[sourceIndex];   // retrieving r,g,b for curr src px.
			sG = sourceBuffer[sourceIndex + 1];
			sB = sourceBuffer[sourceIndex + 2];

			/* !! untested : handling alpha !!
			   sA = sBuffer[sIndex + 3];
			   if (!sA) continue;
			   if (sA != 0xFF) {
				   sR = (sR * sA) >> 8;  // or use /256 instead ??
				   sG = (sG * sA) >> 8;
				   sB = (sB * sA) >> 8;
			   }
			*/
			if (!crossX && !crossY) { // pixel does not cross
				// just add components weighted by squared scale.
				targetBuffer[targetIndex] += sR * sqScale;
				targetBuffer[targetIndex + 1] += sG * sqScale;
				targetBuffer[targetIndex + 2] += sB * sqScale;
			} else if (crossX && !crossY) { // cross on X only
				w = wx * scale;
				// add weighted component for current px
				targetBuffer[targetIndex] += sR * w;
				targetBuffer[targetIndex + 1] += sG * w;
				targetBuffer[targetIndex + 2] += sB * w;
				// add weighted component for next (tX+1) px				
				nw = nwx * scale
				targetBuffer[targetIndex + 3] += sR * nw;
				targetBuffer[targetIndex + 4] += sG * nw;
				targetBuffer[targetIndex + 5] += sB * nw;
			} else if (crossY && !crossX) { // cross on Y only
				w = wy * scale;
				// add weighted component for current px
				targetBuffer[targetIndex] += sR * w;
				targetBuffer[targetIndex + 1] += sG * w;
				targetBuffer[targetIndex + 2] += sB * w;
				// add weighted component for next (tY+1) px				
				nw = nwy * scale
				targetBuffer[targetIndex + 3 * targetWidth] += sR * nw;
				targetBuffer[targetIndex + 3 * targetWidth + 1] += sG * nw;
				targetBuffer[targetIndex + 3 * targetWidth + 2] += sB * nw;
			} else { // crosses both x and y : four target points involved
				// add weighted component for current px
				w = wx * wy;
				targetBuffer[targetIndex] += sR * w;
				targetBuffer[targetIndex + 1] += sG * w;
				targetBuffer[targetIndex + 2] += sB * w;
				// for tX + 1; tY px
				nw = nwx * wy;
				targetBuffer[targetIndex + 3] += sR * nw;
				targetBuffer[targetIndex + 4] += sG * nw;
				targetBuffer[targetIndex + 5] += sB * nw;
				// for tX ; tY + 1 px
				nw = wx * nwy;
				targetBuffer[targetIndex + 3 * targetWidth] += sR * nw;
				targetBuffer[targetIndex + 3 * targetWidth + 1] += sG * nw;
				targetBuffer[targetIndex + 3 * targetWidth + 2] += sB * nw;
				// for tX + 1 ; tY +1 px
				nw = nwx * nwy;
				targetBuffer[targetIndex + 3 * targetWidth + 3] += sR * nw;
				targetBuffer[targetIndex + 3 * targetWidth + 4] += sG * nw;
				targetBuffer[targetIndex + 3 * targetWidth + 5] += sB * nw;
			}
		} // end for sx 
	} // end for sy


	// create result canvas
	const imageDataTarget = new ImageData(targetWidth, targetHeight);
	const tByteBuffer = imageDataTarget.data;
	// convert float32 array into a UInt8Clamped Array
	let pxIndex = 0;
	for (let sIndex = 0, tIndex = 0; pxIndex < targetWidth * targetHeight; sIndex += 3, tIndex += 4, pxIndex++) {
		tByteBuffer[tIndex] = Math.ceil(targetBuffer[sIndex]);
		tByteBuffer[tIndex + 1] = Math.ceil(targetBuffer[sIndex + 1]);
		tByteBuffer[tIndex + 2] = Math.ceil(targetBuffer[sIndex + 2]);
		tByteBuffer[tIndex + 3] = 255;
	}

	return imageDataTarget;
}


const isSerializable=function(value){
	if(typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null) {
		return true;
	}else if(Array.isArray(value)) {
		return value.every(isSerializable);
	}else if (typeof value === 'object') {
		for(const key in value) {
			if(!isSerializable(value[key]))
				return false;
		}
		return true;
	}
}

self.onmessage = event => { // listen for messages from the main thread
	const imageDataSource = event.data.imageData;

	/* preserve callback info if provided */
	let responseParameters = null;
	if(typeof event.data.responseParameters !== 'undefined') {
		if(isSerializable(event.data.responseParameters))
			responseParameters = event.data.responseParameters;
		else
			throw new Error('callback parameters must be serializable');
	}


	if (typeof event.data.scale === 'number') {
		const scale = event.data.scale;
		const imageDataDownscaled = bilinearRescaleImageData(imageDataSource, scale);

		self.postMessage({
			scale,
			finalWidth: imageDataDownscaled.width,
			finalHeight: imageDataDownscaled.height,
			imageDataDownscaled,
			responseParameters
		});

	} else if (typeof event.data.maxWidth === 'number' && typeof event.data.maxHeight === 'number') {
		const sourceWidth = imageDataSource.width;
		const sourceHeight = imageDataSource.height;
		const maxWidth = event.data.maxWidth;
		const maxHeight = event.data.maxHeight;

		/* keep aspect ratio */
		const widthRatio = maxWidth / sourceWidth;
		const heightRatio = maxHeight / sourceHeight;
		const scale = Math.min(widthRatio, heightRatio);

		const imageDataDownscaled = bilinearRescaleImageData(imageDataSource, scale);

		self.postMessage({
			scale,
			finalWidth: imageDataDownscaled.width,
			finalHeight: imageDataDownscaled.height,
			imageDataDownscaled,
			responseParameters
		});

	} else {
		throw new Error('invalid parameters for image resizing');
	}
};