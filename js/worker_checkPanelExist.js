/**
 * @brief Check to see if NASA panel already downloaded
 * @param {@type Object} params 
 */
self.onmessage = async function(params){
    try{
        const directory_name = params.data.dir_name;

        const root_dir = await navigator.storage.getDirectory();

        const sub_dir = await root_dir.getDirectoryHandle(directory_name, {create: false});

        self.postMessage({isAlreadyDownload: true});
        
    }
    catch(err){
            console.log("Need to download NASA IMG.");
            self.postMessage({isAlreadyDownload: false});
    }
    self.close();
}