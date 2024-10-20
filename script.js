const FILE_SIZE_32KB = 32 * 1024;
const FILE_SIZE_64KB = 64 * 1024;
const PADDING_BYTE   = 0xFF;

const dropZone = document.getElementById('drop-zone');
const result   = document.getElementById('result');

let romDefinitions = {};

// Load JDM P30 (203) definitions by default
fetch('203.json')
	.then(response => response.json())
	.then(data => romDefinitions = data)
	.catch(() => result.textContent = 'Error: Unable to load definitions file.');

let binaryData;

with (dropZone) {
	addEventListener('dragover', e => {
		e.preventDefault();
		classList.add('dragover');
	});
	addEventListener('dragleave', () => classList.remove('dragover'));
	addEventListener('drop', handleFile);
}
document.getElementById('file-input').addEventListener('change', handleFile);

function handleFile(e) {
	e.preventDefault();
	dropZone.classList.remove('dragover');
	
	const file = e.dataTransfer ? e.dataTransfer.files[0] : e.target.files[0];
	
	if (!file) {
		result.textContent = 'No file selected.';
		return;
	}

	const fileExtension = file.name.split('.').pop().toLowerCase();
	
	if (fileExtension !== 'bin' && fileExtension !== 'rom') {
		result.textContent = 'Error: File must have a .bin or .rom extension.';
		return;
	}

	if (file.size !== FILE_SIZE_32KB && file.size !== FILE_SIZE_64KB) {
		result.textContent = `Error: File size must be 32KB or 64KB. Actual size: ${file.size} bytes`;
		return;
	}

	readFile(file);
}

function loadFile(filePath) {
		fetch(filePath)
			.then(response => response.blob())
			.then(blob => readFile(blob))
			.catch(() => { result.textContent = 'Error: Unable to load file from path.'; });
}

function readFile(file) {
	with (new FileReader()) {
		onload = event => {
			binaryData = new Uint8Array(event.target.result);

			if (file.size === FILE_SIZE_32KB) {
				const tune = analyzeTune(binaryData, 0, FILE_SIZE_32KB);
				displayResults(file.size, [tune]);
			} else {
				const tune1 = analyzeTune(binaryData, 0, FILE_SIZE_32KB);
				const tune2 = analyzeTune(binaryData, FILE_SIZE_32KB, FILE_SIZE_64KB);
				displayResults(file.size, [tune1, tune2]);
			}

			const tables = findTables(binaryData);
			// displayTables(tables);

			const definitions = identifyDefinitions(binaryData);
			displayDefinitions(definitions);
		};
		readAsArrayBuffer(file);
	}
}

function analyzeTune(binaryData, start, end) {
	let lastNonPaddingByte = end - 1;
	
	while (lastNonPaddingByte >= start && binaryData[lastNonPaddingByte] === PADDING_BYTE) lastNonPaddingByte--;

	const usedSpace = lastNonPaddingByte - start + 1;
	const leftoverSpace = end - start - usedSpace;

	return { usedSpace, leftoverSpace };
}

function displayResults(fileSize, tuneInfos) {
	let html = `<h3>Total file size: ${fileSize} bytes</h3>`;
	
	tuneInfos.forEach((tuneInfo, index) => {
		const start = index === 0 ? '0x0000' : '0x8000';
		const end   = index === 0 && fileSize === FILE_SIZE_32KB ? '0x7FFF' : '0xFFFF';

		html += `
			<h4>Tune ${index + 1} (${start} - ${end}):</h4>
			<p>Used space: ${tuneInfo.usedSpace} bytes</p>
			<p>Leftover space: ${tuneInfo.leftoverSpace} bytes</p>
		`;
	});

	result.innerHTML = html;
}

function findTables(binaryData) {
	const tables         = [];
	const minTableSize   = 16;
	const maxPaddingRows = 2;

	let tableStart      = -1;
	let paddingRowCount = 0;
	let columnCount     = 0;

	for (let i = 0; i < binaryData.length; i += 16) {
		const row          = binaryData.slice(i, i + 16);
		const isPaddingRow = row.every(byte => byte === PADDING_BYTE);

		if (isPaddingRow) {
			paddingRowCount++;

			if (paddingRowCount > maxPaddingRows && tableStart !== -1) {
				tables.push({
					start  : tableStart,
					end    : i - (maxPaddingRows * 16),
					columns: columnCount
				});
				tableStart  = -1;
				columnCount = 0;
			}
		} else {
			paddingRowCount = 0;

			if (tableStart === -1) {
				tableStart  = i;
				columnCount = row.filter(byte => byte !== PADDING_BYTE).length;
			}
		}
	}

	if (tableStart !== -1) {
		tables.push({
			start  : tableStart,
			end    : binaryData.length,
			columns: columnCount
		});
	}

	return tables.filter(table => table.end - table.start >= minTableSize);
}

function displayTables(tables) {
	let html = `<h3>Tables found: ${tables.length}</h3>`;
	
	tables.forEach((table, index) => {
		html += `<h4>Table ${index + 1} (0x${table.start.toString(16).padStart(4, '0')} - 0x${table.end.toString(16).padStart(4, '0')})</h4>`;
		html += '<table><tr><th>Offset</th>';
		
		for (let colIndex = 0; colIndex < table.columns; colIndex++) html += `<th>${colIndex + 1}</th>`;
		html += '</tr>';

		for (let rowIndex = table.start; rowIndex < table.end; rowIndex += 16) {
			html += `<tr><th>0x${rowIndex.toString(16).toUpperCase().padStart(4, '0')}</th>`;

			for (let colIndex = 0; colIndex < table.columns; colIndex++) {
				const byte    = binaryData[rowIndex + colIndex];
				const byteHex = byte.toString(16).toUpperCase().padStart(2, '0');

				html += `<td style="background-color: rgb(0, 0, ${255-byte}); color: white;">${byteHex} <sup>${byte}</sup></td>`;
			}

			html += '</tr>';
		}

		html += '</table>';
	});

	result.innerHTML += html;
}

function identifyDefinitions(binaryData) {
	const definitions = [];

	const pushDefinition = (route, def) => {
		const start = parseInt(def.address, 16);
		const bytes = binaryData.slice(start, start + parseInt(def.bytes, 10));

		definitions.push({ route, address: def.address, info: def, bytes });
	};

	for (const [key, definition] of Object.entries(romDefinitions)) {
		
		if (definition.address === undefined) {
			for (const [subKey, subDefinition] of Object.entries(definition))
				pushDefinition(key + ':' + subKey, subDefinition);
		} else
			pushDefinition(key, definition);
	}

	return definitions;
}

function displayDefinitions(definitions) {
	const ENABLED  = 0xFF;
	const DISABLED = 0x00;

	let html = '<h3>Identified Definitions:</h3>';

	definitions.forEach(def => {
		const bitSpec = def.info.bit ? ` (${def.info.bit}-bit)` : '';

		html += `<hr><h4><i>${def.info.description}</i> <code>${def.route}</code></h4>`;
		html += `<p><b>Address</b>: 0x${def.address} (${def.info.bytes} byte${def.info.bytes > 1 ? 's' : ''})${bitSpec}</p>`;
		html += `<p><b>Notes</b>: ${def.info.notes}</p>`;

		if (def.info.bytes === 1) {
			const byte    = def.bytes[0];
			const byteHex = byte.toString(16).padStart(2, '0').toUpperCase();

			html += byte === ENABLED || byte === DISABLED
				? `<span style="color: white; background-color: ${byte === ENABLED ? 'green' : 'red'};">${byte === ENABLED ? 'Enabled' : 'Disabled'}</span>`
				: `<b>Value</b>: ${byteHex} <sup>${byte}</sup>`;
		} else if (def.info.bytes >= 10) {
			const columns = def.info.bytes >= 100 ? 10 : def.info.bytes;

			html += '<table style="width: auto;"><tr>';

			for (let colIndex = 0; colIndex < columns; colIndex++) html += `<th>${colIndex}</th>`;
			html += '</tr>';

			for (let rowIndex = 0; rowIndex < def.bytes.length; rowIndex += columns) {
				html += '<tr>';

				for (let colIndex = 0; colIndex < columns; colIndex++) {
					const byte = def.bytes[rowIndex + colIndex];
					if (byte === undefined) {
						console.log(`Missing byte at index ${rowIndex + colIndex}`);
						break;
					}

					html += `<td style="background-color: rgb(${byte}, 0, ${255 - byte}); color: white;" title="${byte.toString(16).padStart(2, '0').toUpperCase()}">${byte}</td>`;
				}

				html += '</tr>';
			}

			html += '</table>';
		} else {
			html += '<table style="width: auto;"><tr><th>Offset</th><th>Value</th></tr>';
			def.bytes.forEach((byte, index) => {
				const offset    = parseInt(def.address, 16) + index;
				const offsetHex = offset.toString(16).padStart(4, '0').toUpperCase();
				const byteHex   = byte.toString(16).padStart(2, '0').toUpperCase();

				let value = def.info.scalingFactor && byte ? `${byte} = <span style="font-size: 1.3em";>${Math.round(byte * def.info.scalingFactor)}</span>` : byte;

				html += `<tr><td>0x${offsetHex}</td><td style="text-align: left; background-color: rgb(0, ${255 - byte}, 0); color: ${byte < 128 ? 'black' : 'white'};">${byteHex} <sup>${value}</sup></td></tr>`;
			});
			html += '</table>';
		}
	});

	result.innerHTML += html;
}

loadFile('203.bin');