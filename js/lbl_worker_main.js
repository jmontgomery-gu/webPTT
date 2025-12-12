function swap16(val) {
    return ((val & 0xFF) << 8)
           | ((val >> 8) & 0xFF);
  }
/**
 * Writes height data to Local Private Storage
 * @param {@type Object} meta_data - info about NASA .img file
 * @param {@type string} slice_name - file name for this sub-tile 
 * @param {@type Array<ArrayBuffer>} tile_buff_stack - height data for this sub-tile
 * @returns {@type string}  name - sub-tile written
 */
async function writeData(meta_data, slice_name, tile_buff_stack){
    // get root directory
    const root = await navigator.storage.getDirectory();
    // subdirectory
    let filename_parts = meta_data.filename.split('.img');
    let subdir_name = filename_parts[0];

    const sub_dir = await root.getDirectoryHandle(subdir_name, { create: true});
    let full_slice_name = slice_name + '.bin';
    const filehd = await sub_dir.getFileHandle(full_slice_name , {create: true});

    const write_filehd = await filehd.createSyncAccessHandle();

    const MAX_COLS = 5760;
    const MAX_ROWS = 5632; //5760;

    let write_position = 0;
    for(let row = 0; row < MAX_ROWS; row++){
        const typedArry2 = tile_buff_stack[row];
        await write_filehd.write(typedArry2, {at : write_position});
        write_position += typedArry2.byteLength;
    }
 
    await write_filehd.close();

    return full_slice_name;

}

/**
 * @breif Download NASA *.img Panel, Parse into 64 sub-tiles (grouped by quarter-panel) and write to Local Private Storage
 * @param {@type Object} xml_collection -- contains meta data for NASA File
 * @param {@type Array<Array<latitude-prefix>, Array<longitude-suffix>} param1 
 */
async function getLDEM(xml_collection, [lat_prefix, long_suffix], imageBuffer){
    // fetch data
    let fname = xml_collection.filename;
    const ldem_raw_data = imageBuffer;
    //// convert to LSB ///
    const uint16_array_buffer =  new Int16Array(ldem_raw_data.buffer);
    for (var i = 0; i < uint16_array_buffer.length; i++)
    {
          uint16_array_buffer[i] = swap16(uint16_array_buffer[i]);
    }
    // now store as
    let from_pos = 0;
    let to_pos = 0;
    // num of lat and long values per file (2 bytes each)
    const MAX_COLS = 5760;
    const MAX_ROWS = 5632; //5760;
    const MAX_COLS__IN_BYTES = MAX_COLS * 2;

    
    
    from_pos = 0;
    to_pos = MAX_COLS * 2 ; // two bytes is one short
  
    /**
     * iterator over latitude-prefix-names 
     */
    for( let lat_name_portion of lat_prefix.reverse()){
        // array of arrayBuffer to store data for each sub-tile 
        const l1 = [];
        const l2 = [];

        console.log(lat_name_portion);

        /**
         * each latitude has 8 corresponding sub-tiles associated with it.
         * l1, l2... contains the data associated with sub-tile (starting from left -- > right)
         */
        for(let rows = 0; rows < MAX_ROWS; rows++){
            let chunk1 = ldem_raw_data.slice(from_pos, to_pos);
            //l1.push(Array.from(new Uint8Array(chunk1)));
            l1.push(chunk1);
            from_pos += MAX_COLS__IN_BYTES;
            to_pos += MAX_COLS__IN_BYTES;

            //console.log(l1);

            let chunk2 = ldem_raw_data.slice(from_pos, to_pos);
            l2.push(chunk2);
            from_pos += MAX_COLS__IN_BYTES;
            to_pos += MAX_COLS__IN_BYTES;

        }
        console.log("Processed 2 tiles");

        // now write out the eight tiles for this latitude
        // for each array (stack) write data to Local Private Storage
        let n = "";
        let idx = 0;
        n = await writeData(xml_collection, lat_name_portion + long_suffix[0], l1 );

        idx++;
        n = await writeData(xml_collection, lat_name_portion + long_suffix[1], l2 )

        console.log(`completed tile: ${lat_name_portion} of ${xml_collection.filename}`);
        
    }

    console.log("Loaded file: " + fname);
}

/**
 * Web Worker responsible for:
 * * downloading NASA .img file
 * * parsing .img file into 64 sub-tiles (grouped by quad-panels)
 * * write each sub-tile to Local Private Storage
 * 
 * @param {@type Object} params -- parameters passed from parent
 */
self.onmessage = async function(params){

    //let meta_data = await getMetaData();
    try{
        // const obj = await getLDEM(params.data.meta, params.data.filename_parts);
        const origin = "https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128/";
        // const origin = "https://127.0.0.1:5500/webPTT/img/MOLA_data/meg128/";
    
        // fetch file and post messages about prgress to parent "load_resource_main's main_wwt.onmessage"
        // We have to only include the extension if the browser is not firefox.
        const userAgent = navigator.userAgent;
        let filename = params.data.meta.filename; //  + ".img"
        if (userAgent.includes("Firefox") == false) 
        {
            filename = filename + ".img";
        }

        let imageBuffer = new Uint8Array(129761280);
        let offset = 0;
        let file_chunkSize = 0;
        const uu = origin + filename;
        const response = await fetch(uu);
        for await(const file_chunk of response.body){
            imageBuffer.set(file_chunk, offset);
            offset += file_chunk.length;
            file_chunkSize = file_chunk.length;
            self.postMessage({mType: 'Status', statusValue: file_chunkSize })
        }
        self.postMessage({mType: "Complete"});
        const obj = await getLDEM(params.data.meta, params.data.filename_parts, imageBuffer);
        imageBuffer = null;
    }
    catch(err1){
            console.log(`Error from getLDEM():: ${err1}`);
            imageBuffer = null;
            self.close();
    }

    console.log(params.data.meta.filename);
    const director_name = params.data.dir_name;
    
    // get root directory
    try{
        const root = await navigator.storage.getDirectory();

        // get directory handle
        const sub_dir = await root.getDirectoryHandle(director_name, {create: false});

        let files = [];
        
        // push file names onto array
        for await(let [fname, fhandle] of sub_dir.entries()){
            files.push(fname);
            const access_file = await fhandle.createSyncAccessHandle();
            const file_size = access_file.getSize();
            console.log(`${fname} -- size ${file_size}`);
            access_file.close();

        }
        console.log(`web worker thread: ${files}`);

        self.postMessage({mType: "Finished", files : files, num_files: files.length});
        self.close();
    }
    catch(err){
        console.log(`Error in reading files and sizes in web worker_main: ${err}`);
        self.close();
    }
    
}


