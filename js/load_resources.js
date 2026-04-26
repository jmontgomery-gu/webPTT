/**
 * 
 * @param {String} img_file_name  contains GRD XML file for selected GRD .IMG
 * @returns {Object} meta data for PDS GRD file {min/max lon, min/max lat, ppd, etc.}
 */
async function getMetaData(img_file_name){
    const parser = new DOMParser();
    //const response = await fetch('../img/LOLA_data/ldem512/ldem_512_00n_45n_000_090.xml');
    // ldem_512_00n_45n_000_090.xml
    const response = await fetch('./img/LOLA_data/ldem512/' + img_file_name + '.xml');
    const text = await response.text();
    const xdoc = parser.parseFromString(text, 'text/xml');
    /** @type {HTMLElement} */
    const fname = xdoc.querySelector("file_name");
     /** @type {HTMLElement} */
     const west_deg = xdoc.getElementsByTagName("cart:west_bounding_coordinate")[0].innerHTML;
     //const w_txt = west_deg[0].innerHTML;
 
     /** @type {HTMLElement} */
     const east_deg = xdoc.getElementsByTagName("cart:east_bounding_coordinate")[0].innerHTML;
     /** @type {HTMLElement} */
     const north_deg = xdoc.getElementsByTagName("cart:north_bounding_coordinate")[0].innerHTML;
     /** @type {HTMLElement} */
     const south_deg = xdoc.getElementsByTagName("cart:south_bounding_coordinate")[0].innerHTML;
     /** @type {HTMLElement} */
     const pixel_scale_x = xdoc.getElementsByTagName("cart:pixel_scale_x")[0].innerHTML;
     const pixel_scale_y = xdoc.getElementsByTagName("cart:pixel_scale_y")[0].innerHTML;

     let data_type = xdoc.getElementsByTagName("data_type")[0].innerHTML;
     let sample_bits = undefined;
     
     if(data_type === "SignedLSB2"){
        data_type = "int16";
        sample_bits = 16;
     }
     let img_name = fname.innerHTML
     img_name = img_name.split('.img')[0];
     return {filename: img_name,
        west_deg : parseInt(west_deg), east_deg : parseInt(east_deg), north_deg : parseInt(north_deg), 
        south_deg : parseInt(south_deg), pixel_scale_x: parseInt(pixel_scale_x), pixel_scale_y: parseInt(pixel_scale_y),
        data_type : data_type, sample_bits : parseInt(sample_bits)
        };
     }

     /**
      * 
      * @param {Oject} file_meta_data -- meta data from processed GRD xml file
      * @returns [[string], [string]] -- prefix sub-panels and post-fix sub-panels in degrees
      */
     async function generateSlicedFileName(file_meta_data){
        // compute longitude_deltas
        const NUM_SEGMENTS_LON = 8;
        const NUM_SEGMENTS_LAT = 4;
    
        let degrees_lon =  file_meta_data.east_deg - file_meta_data.west_deg;
        const seg_increment_lon = degrees_lon / NUM_SEGMENTS_LON
    
        let degrees_lat =  file_meta_data.north_deg - file_meta_data.south_deg;
        const seg_increment_lat = degrees_lat / NUM_SEGMENTS_LAT;
        let direction = undefined;
        let north_south = /_[0-9][0-9]n/.test(file_meta_data.filename);
        if( north_south === true){
            direction = "n";
        }
        else{
            direction = "s";
        }
        let filename_lat = [];
        let filename_long = [];
    
        let start_lat = file_meta_data.south_deg;
        let lat_to = "";
        for(let i=0; i < NUM_SEGMENTS_LAT; i++){
            let prefix_filename = `${Math.abs(start_lat + i * seg_increment_lat)}${direction}_${Math.abs(start_lat + (i+1)*seg_increment_lat)}${direction}_`;
            filename_lat.push(prefix_filename);
    
        }
    
         // compute longitude portion of file name
        let start_lon = file_meta_data.west_deg;
        for(let i = 0; i < NUM_SEGMENTS_LON; i++){
            let postfix_filename = `${start_lon + i * seg_increment_lon}_${start_lon + (i+1) * seg_increment_lon}`;
            filename_long.push(postfix_filename);
        }
    
        return [filename_lat, filename_long];
    }

    ///
    

/**
 * @brief Returns the Quarter image panel and meta data associated with mouse click
 * @param {@type string } img_file_name -- NASA Gridded File corresponding to mouse click 
 * @param {*} subtile_file_names -- quarter panel to retrieve 
 */
export async function load_resources_main(img_file_name, subtile_file_names){
       
    let meta_data = await getMetaData(img_file_name);
    let tile_file_names = await generateSlicedFileName(meta_data);

    const main_cwt = new Worker("./js/worker_checkPanelExist.js");
    const main_wwt = new Worker("./js/worker_main.js");
    const main_rwt = new Worker('./js/worker_read.js');

        const readCompletePromise = new Promise((resolve) => {
        // read worker thread
        let subtile_array = [];
        main_rwt.onmessage = function(message){
            if(message.data.success === true ) {
                const subtile_img = new Int16Array(message.data.tile_data);
                const [lat_min, lat_max, lon_min, lon_max] = message.data.lat_lon;
                let beta_tileParams = new tileInfo(
                    16,
                    parseFloat(lat_min),
                    parseFloat(lat_max),
                    parseFloat(lon_min),
                    parseFloat(lon_max),
                    512,
                    5760,
                    5760,
                    3400,
                    'int16',
                    subtile_img
                );
                subtile_array.push(beta_tileParams);

                if(subtile_array.length === 8){
                    console.log (`tile load complete:  ${subtile_array.length}`);
                    subtile_array.reverse();
                    newTiles = subtile_array;
                    main_rwt.terminate();
                    resolve();
                }

            }
            else{
                console.log("Could not read from local storage");
                main_rwt.terminate();
                resolve();
            }

        }
    });

    main_cwt.postMessage({dir_name: img_file_name})

    main_cwt.onmessage =  async function(message){
        const isAlreadyDownload = await message.data.isAlreadyDownload;
        if( isAlreadyDownload === true){
            main_rwt.postMessage({subtile_file_names: subtile_file_names, img_file_name: img_file_name});
        }
        else {
             main_wwt.postMessage({subtile_file_names: subtile_file_names, filename_parts: tile_file_names, meta: meta_data, dir_name: img_file_name, file_names:["file1.dat", "file2.dat"]});
             counter.startDownload();
             counter.setZero();         
             setTimeout(() => {
                alert("This panel has not yet been downloaded from NASA.\n  The process may take up to 10 minutes.\n  Please wait and watch the progress bar at the top of the browswer window.")             
            }, 0);
        }
        //main_cwt.terminate();
    }
   
    // process write worker response 
    main_wwt.onmessage = async function(message){
        if(message.data.mType === "Status"){
            counter.increment(message.data.statusValue);
            //console.log("posting event...");
        }
        else if(message.data.mType === "Complete"){
            console.log("Download Complete.....");
        }
        else if(message.data.mType === "Finished"){
            const value1 = await message.data.files;
            const num_files = message.data.num_files;
                //console.log(value1);
                //console.log(num_files);
            counter.endDownload();
            counter.setZero();
            main_rwt.postMessage({subtile_file_names: subtile_file_names, img_file_name: img_file_name});
                console.log("main_wwt_onmesssage completed...");
            main_wwt.terminate();
        }
    }

    // read worker thread

    await readCompletePromise;
    console.log("load_resources_main, done");
    return ;
}
