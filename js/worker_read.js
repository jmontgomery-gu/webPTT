/**
 * reads file from local storage and return arrayBuffer 
 * @param object key:value pairs 
 * 
 * @return object key:value pairs {data, filename and file size}
 */
self.onmessage = async function (params) {
    const directory_name = params.data.img_file_name;
    const tile_names = params.data.subtile_file_names;

    const root = await navigator.storage.getDirectory();
    let fileSize = 0;
    // get directory handle
    try{
    const sub_dir = await root.getDirectoryHandle(directory_name, {create: false});
    
    let img_data_array = [];
    let img_lat_lon_array = [];
     for await(fn of tile_names){
        const draftFile = await sub_dir.getFileHandle(fn, {
            create: false,
          });
        const accessHandle = await draftFile.createSyncAccessHandle();
         fileSize = accessHandle.getSize();
        const tbuffer = new DataView(new ArrayBuffer(fileSize));
        const readBuffer = accessHandle.read(tbuffer);
        img_data_array.push(tbuffer.buffer);
        accessHandle.flush();
        accessHandle.close();
    }

    // construct meta data needed (by render) for each sub-tile
    // consisting of sub-tile name, min/max latitude/longitude
    for (fn of tile_names){
      // remove '.bin'
      let fn_buff = fn.replaceAll('.bin','');
      let part1 = fn_buff.split(/(n)/);
      let part2 = fn_buff.split('_');
      let is_north = /n/.test(fn_buff);
      let fn_buff_step2 = undefined;
      if(is_north === true){
        fn_buff = fn_buff.replaceAll('n', '');
      }
      else{
        fn_buff = fn_buff.replaceAll('s', '');
      }
      let parts = fn_buff.split('_');
      if(is_north === false){
        // add minus sing
        parts[0] = '-' + parts[0];
        parts[1] = '-' + parts[1];
      }
      img_lat_lon_array.push(parts);
    }
  
    // send message back to main thread
    // containing the buffer data among other things
    let num_tiles = img_data_array.length;
    for( let count = 0; count < num_tiles; count++){
      // for each tile post a message back to parent thread
      const buf = img_data_array.pop();
      const lats_lons = img_lat_lon_array.pop();
      self.postMessage({success: true,
                        tile_data: buf,
                        lat_lon: lats_lons,
                        count: count},
                        [buf]
                      );
    }
  }
  catch(err){
    console.log(`directory not loaded yet: ${directory_name}`);
    self.postMessage({
      success: false,
      imgBuffer: undefined,
      fileName: directory_name,
      fileSize: 0,
    });
  }
    //console.log(`Worker Thread Ending: size of buffer should be zero: ${buffer.byteLength}`);
  };