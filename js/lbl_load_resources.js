/* used during independent testing. no longer necessary
"use strict";
*/


/**
 * 
 * @param {string} fname -- name of file to load
 * @returns {string} contents of *.lbl file
 */
async function getLabelFile(fname){
    // fetch label file

    let lbl_file_name = fname + '.lbl';
    const lbl_response = await fetch("img/MOLA_data/meg128/" + lbl_file_name);
    const lbl_text = await lbl_response.text();
    //let lbl_txt = new String(lbl_text);
    console.log(lbl_text);

    return new String(lbl_text);
}

/**
 * 
 * @param {string} file_txt -- file as a text string
 * @returns {Array[strings]} -- text file split into an Array of Strings
 */
async function parseMetaData(file_txt){
    const lines = file_txt.split(/\r\n|\n|\r/);
    console.log('end of parseMetaData');
    return lines;
}

/**
 * 
 * @param {Array} arrayLines -- text file as a array of strings 
 * @returns {meta object} -- meta data used for processing files
 */
async function extractMetaData(arrayLines)
{   
    const meta_object = {filename: undefined, west_deg: undefined, east_deg: undefined, north_deg:undefined,
                          south_deg:undefined, pixel_scale_x:undefined, pixel_scale_y: undefined, data_type: undefined,
                           sample_bits: undefined    };
    const lineStartWith = ["PRODUCT_ID", "MAXIMUM_LATITUDE", "MINIMUM_LATITUDE", 
        "WESTERNMOST_LONGITUDE", "EASTERNMOST_LONGITUDE", "MAP_RESOLUTION",
    "SAMPLE_BITS" ];
    for(const line of arrayLines){
        // contains a match?
        for(const key of lineStartWith){
            const re = line.match(key);
            if(!(re === null))
            {
                const segmenter = new Intl.Segmenter([], {granularity: 'word'});
                const segmentedText = segmenter.segment(line);
                const words = [...segmentedText].filter(s => s.isWordLike).map(s =>s.segment);
                // this should be a function call....
                switch(key){
                    //case key in words:
                    case /*words[*/ lineStartWith[0] /*]*/:
                        meta_object['filename'] = words[1].toLowerCase();
                        break;
                    
                    case lineStartWith[1]:{
                        meta_object['north_deg'] = parseInt(words[1]);
                        break;
                    }
                    
                    case lineStartWith[2]:{
                        meta_object['south_deg'] = parseInt(words[1]);
                        break;
                    }
                    case lineStartWith[3]:{
                        meta_object['west_deg'] = parseInt(words[1]);
                        break;
                    }
                    case lineStartWith[4]:{
                        meta_object['east_deg'] = parseInt(words[1]);
                        break;
                    }
                    case lineStartWith[5]:{
                        meta_object['pixel_scale_x'] = parseInt(words[1]);
                        meta_object['pixel_scale_y'] = parseInt(words[1]);
                        break;
                    }
                    case lineStartWith[6]:{
                        meta_object['sample_bits'] = parseInt(words[1]);
                        meta_object['data_type'] = 'int16';
                        break;
                    }
                }

                console.log (words);
            }
        }
    }
    return meta_object;
}

/**
 * 
 * @param {lbl meta data} lbl_meta_data 
 * @returns {Array[Array]} latitude and longitude prefix and postfix
 */
async function lbl_generateSlicedFileName(lbl_meta_data){
    // each MARS Gridded *.img file will be partitioned into 
    // two subtile file names

    const NUM_SEGMENTS_LON = 2;
    const NUM_SEGMENTS_LAT = 1;

    let degrees_lon =  lbl_meta_data.east_deg - lbl_meta_data.west_deg;
    const seg_increment_lon = degrees_lon / NUM_SEGMENTS_LON

    let degrees_lat =  lbl_meta_data.north_deg - lbl_meta_data.south_deg;
    const seg_increment_lat = degrees_lat / NUM_SEGMENTS_LAT;
    let direction = undefined;
    let north_south = /megt[0-9][0-9]n/.test(lbl_meta_data.filename);
    if( north_south === true){
        direction = "n";
    }
    else{
        direction = "s";
    }
    let filename_lat = [];
    let filename_long = [];

    let start_lat = null;
    let lat_to = "";
    if (curBodyData.datasetName === "LOLA"){
        start_lat = lbl_meta_data.south_deg;
        for(let i=0; i < NUM_SEGMENTS_LAT; i++){

            let prefix_filename = `${Math.abs(start_lat + i * seg_increment_lat)}${direction}_${Math.abs(start_lat + (i+1)*seg_increment_lat)}${direction}_`;
            filename_lat.push(prefix_filename);
    
        }
    }
    else {
        // MOLA mget00n000hb is a special case. The latitude for these 
        // tiles span north and south. 
        // So the prefix latitude (starting latitude) has a north direction
        // and the suffix latitude (ending latitude)has a south direction

        let latitude_ending_direction = direction;
        let special_direction_test = /megt00n/.test(lbl_meta_data.filename);
        if(special_direction_test=== true){
            latitude_ending_direction = "s";
        }
        start_lat = lbl_meta_data.north_deg;
        for(let i=0; i < NUM_SEGMENTS_LAT; i++){

            let prefix_filename = `${Math.abs(start_lat + i * seg_increment_lat)}${direction}_${Math.abs(start_lat - (i+1)*seg_increment_lat)}${latitude_ending_direction}_`;
            filename_lat.push(prefix_filename);
    
        }
    }
    

     // compute longitude portion of file name
     let start_lon = lbl_meta_data.west_deg;
     for(let i = 0; i < NUM_SEGMENTS_LON; i++){
         let postfix_filename = `${start_lon + i * seg_increment_lon}_${start_lon + (i+1) * seg_increment_lon}`;
         filename_long.push(postfix_filename);
     }
 
     return [filename_lat, filename_long];
    
}

/**
 * main driver program to process NASA gridded files MGS
 * - load & parse *.lbl for for meta data
 * - extract internal lat/log used for internal naming sub-panel slices
 * - load web workers to process files
 *  * lbl_main_cwt -- checks private storage to see if *.img already downloaded
 *      *-- if yes, call read worker
 *      *-- if no, call write worker
 *  * lbl_main_wwt -- 
 *      *-- downloads *.img
 *      *-- creates sub-panels
 *      *-- writes to persistent storage
 *      *-- calls read worker
 *  * lbl_main_rwt --
 *      *-- reads sub-tiles used to fulfill request to load HiRes panel
 *      *-- populates tileInfo object with meta data and image files for display
 * 
 * @param {string} img_file_name NASA file name of interest (no .img)
 * @param {Array[Strings]} subtile_file_names -- array of sub-tiles need to fulfill request
 */
export async function lbl_load_resources_main(img_file_name="megt00n000hb", subtile_file_names=["44n_0n_0_45"]){
    console.log("Start Process..");
    let marsFileSize = 129761280;

    /////////// extra added .lbl ////////////////
    let lbl_fname = img_file_name ;
    const re = await getLabelFile(lbl_fname);
    let meta_data = await parseMetaData(re);
    // extractMetaData(meta_data).then( (value)=>{
    //     console.log(value);
    // });
    let lbl_meta_data = await  extractMetaData(meta_data);

    console.log(lbl_meta_data);

    // generate slice names. They we be used to store processed gridded file
    let lbl_tile_file_names = await lbl_generateSlicedFileName(lbl_meta_data);
    
    // create worker threads
    // 1. check if img file already downloaded 
    //    - calls the read worker thread if so
    //    - else  calls the write worker thread
    const lbl_main_cwt = new Worker("./js/lbl_worker_checkPanelExist.js");
    const lbl_main_wwt = new Worker("./js/lbl_worker_main.js");
    const lbl_main_rwt = new Worker('./js/lbl_worker_read.js');

    //
    // post message to check directory exists worker thread
    //
    lbl_main_cwt.postMessage({dir_name: img_file_name});

    //
    // check file exist worker thread response
    //
    lbl_main_cwt.onmessage =  async function(message){
        const isAlreadyDownload = await message.data.isAlreadyDownload;
        if( isAlreadyDownload === true){
            lbl_main_rwt.postMessage({subtile_file_names: subtile_file_names, img_file_name: img_file_name});
        }
        else {
            lbl_main_wwt.postMessage({subtile_file_names: subtile_file_names, filename_parts: lbl_tile_file_names, meta: lbl_meta_data, dir_name: img_file_name, file_names:["file1.dat", "file2.dat"]});
            
            //
            // init download byte counter filesize 129761280 
            counter.startDownload();
            counter.setZero(0, marsFileSize);

            setTimeout(() => {
                alert("This panel has not yet been downloaded from NASA.\nThe process may take a couple of minutes.\nPlease wait and watch the progress bar at the top of the browswer window.")             
            }, 0);             
        }
    }

    //
    // write worker thread response. 
    //  -- calls Read worker thread once writing to OPFS is completed
    //
    lbl_main_wwt.onmessage = async function(message){
        if(message.data.mType === "Status"){
            counter.increment(message.data.statusValue);
        }
        else if(message.data.mType === "Complete"){
            console.log("Download Complete.....");
        }
        else if(message.data.mType === "Finished"){
            const value1 = await message.data.files;
            const num_files = message.data.num_files;
            //console.log(value1);
            //console.log(num_files);
            counter.setZero(0, marsFileSize );
            counter.endDownload();
            lbl_main_rwt.postMessage({subtile_file_names: subtile_file_names, img_file_name: img_file_name});
            lbl_main_wwt.terminate();
        }
    }

    // Read Worker Thread
    // 1. reads tile-slice from OPFS
    // 2. Creates array of tile-slices for one HiRes panel
    // 3. sets global array with meta-data and image files for display
    //
    let subtile_array = [];
    lbl_main_rwt.onmessage = function(message){
        if(message.data.success === true ) {
            const subtile_img = new Int16Array(message.data.tile_data);
            const [ lat_max, lat_min, lon_min, lon_max] = message.data.lat_lon;
            let beta_tileParams = new tileInfo(
                16,
                ////////////////// different for lbl ///////////////////////
                //////////////////lat_min and lat_max are swapped ///////////////////////
                parseFloat(lat_min),
                parseFloat(lat_max),
                
                parseFloat(lon_min),
                parseFloat(lon_max),
                128,
                5760,
                5632,
                3400,
                'int16',
                subtile_img
            );
            subtile_array.push(beta_tileParams);
        
            if(subtile_array.length === 2){
                console.log (`tile load complete:  ${subtile_array.length}`);
                subtile_array.reverse();
                newTiles = subtile_array;
                initTextures_hiRes_afterLoad();
                lbl_main_rwt.terminate();

            }
            // const subtiles_imgData = new Uint8Array(message.data.imgBuffer[0]);
            // console.log(subtiles_imgData);
            // delete message.imgBuffer;
        }
        else{
            console.log("Could not read from local storage");
            lbl_main_rwt.terminate();
        }

    }
}