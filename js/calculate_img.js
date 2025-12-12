// Important (JCM): For the moment we are lucky that LOLA-512 and MOLA-128 are the same on the NASA image sizes in terms of degrees
// These will have to become parameters as we move to allow more datasets.
const IMG_W_DEG = 90;
const IMG_H_DEG = 45;
/**
 * @brief Compute the lower left latitutude/longitude of NASA Panel given mouse latitude/longitude
 * @param {@type Number} latitude 
 * @param {@type Number} longitude 
 * @returns {@type Array<number>}
 */
export function calculate_img(latitude, longitude){
let lat = Math.floor((latitude + 90) / IMG_H_DEG) * IMG_H_DEG - 90;
let lon = Math.floor(longitude / IMG_W_DEG) * IMG_W_DEG;
return [lat, lon];
}

/**
 * 
 * @param {@type Number} latitude 
 * @param {@type Number} longitude 
 * @param {@type String} datasetName   // We need to know the MOLA/LOLA dataset being used for the file name format
 * @returns {@type Array<string>} collection of tile image names for this panel
 * 
 */
export function sub_panels_from_lat_lon(latitude, longitude, datasetName){
    if (datasetName == "LOLA")
    {
        return sub_panels_from_lat_lon_LOLA(latitude, longitude);
    }
    else if (datasetName == "MOLA")
    {
        return sub_panels_from_lat_lon_MOLA(latitude, longitude);
    }
}
    
/**
 * 
 * @param {@type Number} latitude 
 * @param {@type Number} longitude 
 * @returns {@type Array<string>} collection of tile image names for this panel
 * 
 */
export function sub_panels_from_lat_lon_LOLA(latitude, longitude){
    const SUB_PANEL_W_DEG = 45;
    const SUB_PANEL_H_DEG = 22.5;
    const SUB_TILE_SIZE_W_DEG = 11.25;
    const SUB_TILE_SIZE_H_DEG = 11.25;
    let sub_panel_direction = 'n';

    // lower left corner of sub_panel
    let lat = Math.floor((latitude + 90) / SUB_PANEL_H_DEG) * SUB_PANEL_H_DEG - 90;
    let lon = Math.floor(longitude / SUB_PANEL_W_DEG) * SUB_PANEL_W_DEG;

    // north or south latitude
    if (lat < 0){
        sub_panel_direction ='s';
    }

    // generate names of sub_panels_to_load
    let sub_panel_file_names = [];

    // for each lon --> 2 lat
    for(let lon_deg = lon; lon_deg < lon + SUB_PANEL_W_DEG; lon_deg += SUB_TILE_SIZE_W_DEG){
        // 
        for (let lat_deg = lat; lat_deg < lat + SUB_PANEL_H_DEG; lat_deg += SUB_TILE_SIZE_H_DEG){
            let sub_tile_name = '' +
                                Math.abs(lat_deg) + sub_panel_direction + 
                                '_' + Math.abs( (lat_deg + SUB_TILE_SIZE_H_DEG) ) + sub_panel_direction +
                                '_' + lon_deg + 
                                '_' + (lon_deg + SUB_TILE_SIZE_W_DEG) + '.bin';
            sub_panel_file_names.push(sub_tile_name);                    
        }
    }

    return sub_panel_file_names;
}

/**
 * 
 * @param {@type Number} latitude 
 * @param {@type Number} longitude 
 * @returns {@type Array<string>} collection of tile image names for this panel
 * 
 */
export function sub_panels_from_lat_lon_MOLA(latitude, longitude){
    const SUB_PANEL_W_DEG = 90.0;
    // const SUB_PANEL_W_DEG = 45.0;
    const SUB_PANEL_H_DEG = 44.0;
    const SUB_TILE_SIZE_W_DEG = 45.0;
    const SUB_TILE_SIZE_H_DEG = 44.0;
    let sub_panel_direction = 'n';

    // lower left corner of sub_panel
    let lat = Math.floor((latitude + 88) / SUB_PANEL_H_DEG) * SUB_PANEL_H_DEG - 88;
    let lon = Math.floor(longitude / SUB_PANEL_W_DEG) * SUB_PANEL_W_DEG;

    // north or south latitude
    if (lat < 0){
        sub_panel_direction ='s';
    }

    // generate names of sub_panels_to_load
    let sub_panel_file_names = [];

    // for each lon --> 2 lat
    for(let lon_deg = lon; lon_deg < lon + SUB_PANEL_W_DEG; lon_deg += SUB_TILE_SIZE_W_DEG){
        // 
        for (let lat_deg = lat; lat_deg < lat + SUB_PANEL_H_DEG; lat_deg += SUB_TILE_SIZE_H_DEG){
            // let sub_tile_name = '' +
            //                     Math.abs(lat_deg) + sub_panel_direction + 
            //                     '_' + Math.abs( (lat_deg + SUB_TILE_SIZE_H_DEG) ) + sub_panel_direction +
            //                     '_' + lon_deg + 
            //                     '_' + (lon_deg + SUB_TILE_SIZE_W_DEG) + '.bin';
            let sub_tile_name = '' +
                                Math.abs( (lat_deg + SUB_TILE_SIZE_H_DEG) ) + sub_panel_direction + 
                                '_' + Math.abs(lat_deg) + sub_panel_direction +
                                '_' + lon_deg + 
                                '_' + (lon_deg + SUB_TILE_SIZE_W_DEG) + '.bin';
            // hack mget00nxxx special handling
            // 0s_44s, based on NASA file naming it should be
            // 0n_44s, we manually correct for Mars
            let special_latitude_direction = "s";
            let needSpecialCorrection = /0s_44s/.test(sub_tile_name);
            if(needSpecialCorrection)
                sub_tile_name = sub_tile_name.replace("0s_44s", "0n_44s");

            sub_panel_file_names.push(sub_tile_name);                    
        }
    }

    return sub_panel_file_names;
}

/**
 * 
 * @param {@type Number} latitude 
 * @param {@type Number} longitude 
 * @returns {@type string} NASA Panel Name
 */
export function img_name_from_lat_lon(latitude, longitude, datasetName){
    if (datasetName == "LOLA")
    {
        return img_name_from_lat_lon_LOLA(latitude, longitude);
    }
    else
    {
        return img_name_from_lat_lon_MOLA(latitude, longitude);
    }
}

/**
 * 
 * @param {@type Number} latitude 
 * @param {@type Number} longitude 
 * @returns {@type string} NASA Panel Name
 */
export function img_name_from_lat_lon_LOLA(latitude, longitude){
    let lat = Math.floor((latitude + 90) / IMG_H_DEG) * IMG_H_DEG - 90;
    let lon = Math.floor(longitude / IMG_W_DEG) * IMG_W_DEG;

    let img_file = "ldem_512_";
    let lat_direction=undefined;
    if( lat < 0 ){
        lat_direction = 's';
    }
    else{
        lat_direction ='n';
    }
    // lat_num_digits
    let lat_num_digits = '0';
    let lat_num_digits_end = '';

    if(Math.abs(lat) === 45 && lat_direction === 's'){
        lat_num_digits_end = '0';
    }
    if(Math.abs(lat) === 45 || Math.abs(lat) === 90){
        lat_num_digits = '';
    }
    
    let lon_num_digits_start = '';
    let lon_num_digits_end = '';
    if (Math.abs(lon) === 0){
        lon_num_digits_start = '00';
        lon_num_digits_end = '0';
    }
    else if(Math.abs(lon) === 90) {
        lon_num_digits_start = '0';
        lon_num_digits_end = '';
    }
    let fname = `${img_file + lat_num_digits + Math.abs(lat) +
    lat_direction}_${lat_num_digits_end}${Math.abs(lat + 45)}${lat_direction}_${lon_num_digits_start}${Math.abs(lon)}_${lon_num_digits_end}${Math.abs(lon) + 90}` ;
    console.log(fname);

    return fname;
}

/**
 * 
 * @param {@type Number} latitude 
 * @param {@type Number} longitude 
 * @returns {@type string} NASA Panel Name
 */
export function img_name_from_lat_lon_MOLA(latitude, longitude){
    let lat = Math.floor((latitude + 88) / (IMG_H_DEG - 1)) * (IMG_H_DEG - 1) - (88/2); // Mola is 44 degrees tall in latitude
    let lon = Math.floor(longitude / IMG_W_DEG) * IMG_W_DEG;                        // and maxes out at +-88

    let img_file = "megt";
    let lat_direction=undefined;
    if( lat < 0 ){
        lat_direction = 's';
    }
    else{
        lat_direction ='n';
    }
    // lat_num_digits
    let lat_num_digits = '0';
    let lat_num_digits_end = '';

    if(Math.abs(lat) === 44 && lat_direction === 's'){
        lat_num_digits_end = '0';
    }
    if(Math.abs(lat) === 44 || Math.abs(lat) === 88){
        lat_num_digits = '';
    }
    
    let lon_num_digits_start = '';
    let lon_num_digits_end = '';
    if (Math.abs(lon) === 0){
        lon_num_digits_start = '00';
        lon_num_digits_end = '0';
    }
    else if(Math.abs(lon) === 90) {
        lon_num_digits_start = '0';
        lon_num_digits_end = '';
    }
    let fname = `${img_file + lat_num_digits + Math.abs(lat) +
    lat_direction}${lon_num_digits_start}${Math.abs(lon)}hb` ;
    console.log(fname);

    return fname;
}