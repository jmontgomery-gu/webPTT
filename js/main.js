/**
 * starting point for html processing
 */

/**
 *
 */

"use strict";

//import { load_resources_main } from './load_resources.js';
// import * as geometry from 'spherical-geometry-js';

var lineVertSource = `#version 300 es
in vec3 aVertexPosition;
uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;
void main(void) 
{
        gl_Position = uPMatrix * uMVMatrix * vec4(aVertexPosition, 1.0);
}`;

var lineFragSource = `#version 300 es
precision highp float;
uniform vec3 lineColor;
out vec4 fragColor;
void main(void) 
{
  fragColor = vec4(lineColor, 1.0);      
}
`;

var profileVertSource = `#version 300 es

uniform mat4 uPMatrix;

in vec4 pos;
out vec2 LongLat;
out float Dist;

void main(void)
{
	LongLat = pos.zw;
  Dist = pos.y;

  // We only need x for the position of the vertex because the framebuffer is 1D
	gl_Position = uPMatrix * vec4(pos.x, 0.0, 0.0, 1.0);
}
`;

var profileFragSource = `#version 300 es
precision highp float;
uniform sampler2D heightMap;

in vec2 LongLat;
in float Dist;

out vec4 fragColor;
void main(void)
{
  float height = texture(heightMap, LongLat).r;

  fragColor = vec4(Dist / 1000.0, height / 2.0, 0.0, 1.0);  // It's measured in .5m units.
}
`;

var bannerVertSource = `#version 300 es
in vec3 aVertexPosition;
in vec2 aVertexUV;

uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;

out vec2 uv;
void main(void) 
{
  uv = aVertexUV;
  gl_Position = uPMatrix * uMVMatrix * vec4(aVertexPosition, 1.0);
}`;

var bannerFragSource = `#version 300 es
precision highp float;
uniform sampler2D textMap;

in vec2 uv;
out vec4 fragColor;
void main(void) 
{
  vec4 col = texture(textMap, uv);
  fragColor = col;      
}
`;

/**
 * Create a custom event "valuechange" for monitoring percent download 
 * for fetch'ed documents
 */
class Counter extends EventTarget {
  constructor(initialValue = 0, initialFileSize = 2123366400) {
    super();
    this.value = initialValue;
    this.percentComplete = 1;
    this.finished_size = initialFileSize;
  }

  #emitChangeEvent() {
    this.dispatchEvent(
      new CustomEvent("valuechange", { detail: this.percentComplete })
    );
  }

  #emitDownloadStartEvent() {
    this.dispatchEvent(
      new CustomEvent("downloadStart", { detail: this.percentComplete })
    );
  }

  #emitDownloadEndEvent() {
    this.dispatchEvent(
      new CustomEvent("downloadEnd", { detail: this.percentComplete })
    );
  }

  increment(fsize) {
    this.value += fsize;
    this.percentComplete = (this.value / this.finished_size) * 100;
    this.#emitChangeEvent();
  }

  setZero(newInitVal = 0, newInitFileSize = 2123366400 ){
    this.value = newInitVal;
    this.finished_size = newInitFileSize;
    this.percentComplete = 1;
    this.#emitChangeEvent();
  }

  startDownload() {
    this.#emitDownloadStartEvent();
  }

  endDownload() {
    this.#emitDownloadEndEvent();
  }
};
class tileInfo {
  constructor(
    sample_bits,
    latitude_min,
    latitude_max,
    longitude_min,
    longitude_max,
    pix_per_deg,
    columns,
    rows,
    max_integer_value,
    data_type,
    image_data
  ) {
    this.sample_bits = sample_bits;
    this.latitude_min = latitude_min;
    this.latitude_max = latitude_max;
    this.longitude_min = longitude_min;
    this.longitude_max = longitude_max;
    this.pix_per_deg = pix_per_deg;
    this.columns = columns;
    this.rows = rows;
    this.max_integer_value = max_integer_value;
    this.data_type = data_type;
    this.image_data = image_data;
    this.vertex_buffer = null;
    this.index_buffer = null;
    this.vertexCount = 0;
    this.tex_coord_buffer = null;
    this.tex_object = null;
    this.tex_inverted = false; // Should be false if the texture is not inverted.  NASA native .img files are inverted

    // ThreeD buffers.  These will hold the 3D mesh for the part of the selected area that lies within the 
    // bounds of this tile
    this.threeD_vertices = null;
    this.threeD_texCoord = null;
    this.threeD_indices = null;
    this.segLonRes = 1000; // The number of vertices horizontally and vertically in the area patch for 3D rendering.
    this.segLatRes = 1000;
  }

  initializeOpenGLBuffer(gl) {
  
    const float_array_buffer = Float32Array.from(this.image_data);
    this.tex_object = gl.createTexture();
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindTexture(gl.TEXTURE_2D, this.tex_object);

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.R16F,
      this.columns,
      this.rows,
      0,
      gl.RED,
      gl.FLOAT,
      float_array_buffer
    );
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    // Setup vertex and index buffers too.
    // We will assume that, if the texture is partial, then it is anchored in the upper-left
    // corner of the full power-of-2 texture space.  This is no longer needed in a non-power-of-two world.
    //
    // The comments here are being kept in case we determine that there are compatiblity issues.
    //
    // var s_limit = tileParams.columns / tileParams.width_power_of_2;
    // var t_limit = tileParams.rows / tileParams.height_power_of_2;
    var texCoords;
    if (this.tex_inverted) {
      texCoords = [
        // 0.0, 0.0, //tex-v0
        // 0.0, t_limit, //tex-v1
        // s_limit, t_limit, //tex-v2
        // s_limit, 0.0, //tex-v3
        0.0,
        0.0, //tex-v0  ##### See the comment about v0 below
        0.0,
        1.0, //tex-v1
        1.0,
        1.0, //tex-v2
        1.0,
        0.0, //tex-v3
      ];
    } else {
      texCoords = [
        // 0.0, t_limit, //tex-v0
        // 0.0, 0.0, //tex-v1
        // s_limit, 0.0, //tex-v2
        // s_limit, t_limit, //tex-v3
        0.0,
        1.0, //tex-v0  #### See the comment about v0 below
        0.0,
        0.0, //tex-v1
        1.0,
        0.0, //tex-v2
        1.0,
        1.0, //tex-v3
      ];
    }

    var vertices = [
      this.longitude_min,
      this.latitude_max,
      0.0, // v0    #### Note the latitude_max here.  Therefore univerted should be texcoords (0, 1)!
      this.longitude_min,
      this.latitude_min,
      0.0, // v1
      this.longitude_max,
      this.latitude_min,
      0.0, // v2
      this.longitude_max,
      this.latitude_max,
      0.0, // v3
    ];

    // create indices, order of vertices to use in creating triangles
    var indices = [
      3,
      2,
      1, // triangle 1, half of square
      3,
      1,
      0, // triangle 2, other half of square
    ];

    // texture coords
    this.tex_coord_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tex_coord_buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);

    // now we have the vertices and indices we can create the vertex and indice buffer objects
    // used by GLSL
    this.vertex_buffer = gl.createBuffer(); // create the vertex buffer object handle
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertex_buffer); // bind vertex buffer object handle
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null); // done with vbo, so unbind

    //  create, bind index buffer
    this.index_buffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.index_buffer);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array(indices),
      gl.STATIC_DRAW
    );
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);

    // mat4.identity(pMatrix);
  }

  // Functions for a 3D rendering of a selected area patch on the surface
  setupTileAreaMesh(gl, lonMin, latMin, lonMax, latMax)
  {
    this.releaseTile3DResources();
    
    if (lonMin > this.longitude_max || lonMax < this.longitude_min || latMin > this.latitude_max || latMax < this.latitude_min)
      return;

    // Compute the boundaries of the part of the 3D area that is contained in this tile
    var segLonMin = Math.max(this.longitude_min, lonMin);
    var segLonMax = Math.min(this.longitude_max, lonMax);
    var segLatMin = Math.max(this.latitude_min, latMin);
    var segLatMax = Math.min(this.latitude_max, latMax);

    var uMin = (segLonMin - this.longitude_min) / (this.longitude_max - this.longitude_min);
    var uMax = (segLonMax - this.longitude_min) / (this.longitude_max - this.longitude_min);
    var vMin = (segLatMin - this.latitude_min) / (this.latitude_max - this.latitude_min);
    var vMax = (segLatMax - this.latitude_min) / (this.latitude_max - this.latitude_min);
    
    // Make this portion of the area patch a 500x500 mesh 
    var lonRes = this.segLonRes, latRes = this.segLatRes;

    var texCoords = new Float32Array(lonRes * latRes * 2);  // 2-coords per vert
    var uStep = (uMax - uMin) / (lonRes - 1);
    var vStep = (vMax - vMin) / (latRes - 1);
    var count = 0;
    for (let v = vMin; v < vMax + vStep / 2.0; v += vStep)
    {
      for (let u = uMin; u < uMax + uStep / 2.0; u += uStep)
      {
        texCoords[count++] = u;
        texCoords[count++] = (this.tex_inverted ? 1.0 - v : v); 
      }
    }

    var vertices = new Float32Array(lonRes * latRes * 3); 
    let lonStep = (segLonMax - segLonMin) / (lonRes - 1);
    let latStep = (segLatMax - segLatMin) / (latRes - 1);
    count = 0; 
    for (let lat = segLatMin; lat < segLatMax + latStep / 2.0; lat += latStep)
    {
      for (let lon = segLonMin; lon < segLonMax + lonStep / 2.0; lon += lonStep)
      {
        vertices[count++] = lon;
        vertices[count++] = lat;
        vertices[count++] = 0.0;
      }
    }

    // create indices, order of vertices to use in creating triangles
    var indices = new Uint32Array((lonRes - 1) * (latRes - 1) * 6);  // Two triangles making a quad at each vertex (but last)
    count = 0;
    for (let j = 0; j < latRes - 1; j++)
    {
      for (let i = 0; i < lonRes - 1; i++)
      {
        let base = lonRes * j;
        indices[count++] = (base + i) * 1;       
        indices[count++] = (base + i + lonRes + 1) * 1;
        indices[count++] = (base + i + lonRes) * 1;

        indices[count++] = (base + i + lonRes + 1) * 1;
        indices[count++] = (base + i) * 1;
        indices[count++] = (base + i + 1) * 1;
      }
    } 
  
    // texture coords
    this.threeD_texCoord = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.threeD_texCoord);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    // now we have the vertices and indices we can create the vertex and indice buffer objects
    // used by GLSL
    this.threeD_vertices = gl.createBuffer(); // create the vertex buffer object handle
    gl.bindBuffer(gl.ARRAY_BUFFER, this.threeD_vertices); // bind vertex buffer object handle
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null); // done with vbo, so unbind

    //  create, bind index buffer
    this.threeD_indices = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.threeD_indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  }

  releaseTile3DResources(gl)
  {
    if (this.threeD_indices != null)
    {
      gl.deleteBuffer(this.threeD_indices);
      this.threeD_indices = null;
    }
    if (this.threeD_vertices != null)
    {
      gl.deleteBuffer(this.threeD_vertices);
      this.threeD_vertices = null;
    }
    if (this.threeD_texCoord != null)
    {
      gl.deleteBuffer(this.threeD_texCoord);
      this.threeD_texCoord = null;
    }
  }

  releaseOpenGLBuffers(gl) {
    gl.deleteTexture(this.tex_object);
    gl.deleteBuffer(this.vertex_buffer);
    gl.deleteBuffer(this.index_buffer);
    gl.deleteBuffer(this.tex_coord_buffer);

    this.releaseTile3DResources(gl);
  }
}

// JCM: The panelSizeDeg has to be split into a W and H because the panels are not the same
// aspect ratio in the two datasets.  This will allow us to get rid of the special case for 
// the PanelHeight functions below.
var moonData = {
  bodyName: "Moon",
  datasetName: "LOLA", 
  eqMetersPerDegree: 30323.0,
  elevationMin: -9128.0,
  elevationMax: 10778.0,
  dataUnits: .5,
  navReliefScale: 2.0,
  hiresReliefScale: 1.0,
  lowResPath: "img/LOLA_data/ldem4/ldem_4.img",
  lowResEndianness: "LSB",
  imageNameHead: "ldem_512_",
  monochromeColor: [.65, .65, .65],
  useMono: 1.0,                       // 1.0 = true, 0.0 = false
  panelSizeDeg: 22.5
};

var marsData = {
  bodyName: "Mars",
  datasetName: "MOLA",
  eqMetersPerDegree: 59245.0,
  elevationMin: -8208.0,
  elevationMax: 21249.0,
  dataUnits: 1.0,  // In meters 
  navReliefScale: 4.0,
  hiresReliefScale: 1.0,
  lowResPath: "img/MOLA_data/meg004/megt90n000cb.img",
  lowResEndianness: "MSB",
  imageNameHead: "megt",
  monochromeColor: [237.0 / 255.0, 167.0 / 255.0, 110.0 / 255.0],    // Pulled from image of mars
  useMono: 1.0,                       // 1.0 = true, 0.0 = false
  panelSizeDeg: 45.0  
};

var curBodyData =  moonData;

// global Accessible mouse click position 
var mouse_click_latitude = 0;
var mouse_click_longitude = 0;
var newTiles = []; //undefined;

// Extension info
var anisotropy;

// Shader settings that are common to both views
var LightDir = [-0.86602539 * 0.707, -0.86602539 * 0.707, 0.5];

// Nav window data
var gl_nav = null;
var canvas_nav = null;
var gpuProgram_nav;
var texScale_nav = 1.0;
var vertexBuffer_nav = null; // vertex buffer for storing square
var indexBuffer_nav = null; // index buffer for square
var texCoordBuffer_nav = null;
var vertices_nav = []; // javascript array to hold vertices
var indices_nav = []; // javascript array used to hold indices
var textcoords_nav = []; // javascript array used to hold texture coords as it relates to geometery
var colorTex_nav = null; // used to hold the color texture handle from gl.createTexture();
var colorTex_hiRes = null;
var heightTex_nav = null; // used to hold the texture handle from gl.createTexture();

// Grid data for the nav window
var gridProgram_nav;
var gridVertBuffer_nav = null;
var gridIndexBuffer_nav = null;
var gridIndexLength = 0;
var curPanel = 25;
var curPanelVertBuffer_nav = null;
var panelWidthLon = 2.0 * curBodyData.panelSizeDeg;
var panelHeightLat = curBodyData.panelSizeDeg;
var curViewVertBuffer_nav = null;
function DpanelHeightLat(){
  let latitude = curBodyData.panelSizeDeg;
  if(curBodyData.datasetName === "MOLA"){
    latitude = 44.0 ; // Mars latitude is 0-44 degrees
  }
  return latitude;
}
function DpanelWidthLon(){
  let longitude = 2.0 * curBodyData.panelSizeDeg;
  if(curBodyData.datasetName === "MOLA"){
    longitude = 90.0 ; // Mars longitude is 0-45 degrees
  }
  return longitude;
}
let panelWidthLon_Body = {bodyType: "MOLA", MOLA : 90, LOLA : 90};
let panelHeightLat_Body = {bodyType: "MOLA", MOLA: 88, LOLA : curBodyData.panelSizeDeg};

var viewCenter_nav = [180.0, 0.0];
var viewSize_nav = 90.0;

// Hires window data
var gl_hiRes = null;
var canvas_hiRes = null;
var gpuProgram_hiRes;
var texScale_hiRes = 1.0;
var panelSize_hiRes = 11.25;  // This is the half-size of one of the moon's quarter-panels. This should change for Mars  
var viewCenter_hiRes = [112.5, 33.75];  // This is (long, lat) --> (x, y)
var viewSize_hiRes = 11.25;             // latitude spans 4 * viewSize and Longitude spans 2 * viewSize
var panRate_hiRes = viewSize_hiRes / 2.0;
var zoomRate_hiRes = 1.0;
var lastMouseLoc_hiRes = [0, 0];
var zoomCenterX = 0;
var zoomCenterY = 0;
var panning_hiRes = false; // Booleans for mouse navigation interaction
var zooming_hiRes = false;
var tileArray = []; // This will hold arrays of texture panel data, starting with the panel's json data,
                    // and ending with the panel's opengl objects
                    //
                    // {sample_bits, latitude_min, latitude_max, longitude_min, longitude_max,
                    //  pix_per_deg, columns, rows, max_integer_value, data_type,
                    //  image_data, vertex_buffer, index_buffer, tex_coord_buffer, tex_object}  
var threeD_azimuth = -45;
var threeD_altitude = 30;
var threeD_fov = 30;
var rotating3D = false;
var zooming3D = false;

// Data for low-resolution preview
var previewTexObj = null;
var previewVertBuffer = null;
var previewTexCoordBuffer = null;

// Data for hiRes interaction
const navMode = 1;
const profileMode = 2;
const areaMode = 3;
var curMode = navMode;
var rendering3D = false;

// Data for the text banners in the hi-res window
var bannerVertexBuffer = null;
var bannerTexBuffer = null;
var bannerProgram_hiRes = [];
var bannerVerts = [];
var bannerTexCoord = [];
var bannerTextureObj = null;
var bannerShowCursorLoc = true;   // Will default to false, but then we will have a button for it at the side.
var bannerCurLat = 0.0;
var bannerCurLon = 0.0;

// Data for profile curves
var pathProgram_hiRes = [];
var pathVerts = [];
var pathTex = [];
var profileVerts = [];
var profileTotalDist = 0.0;  // Total distance for calcualting latitudes and longitudes along path for log output
var pathVertBuffer = null;
var pathPointMoving = -1;
var firstPathPointMoved = true; // this will only be false when moving the initial point of a path.

// Data for the profile curve renderbuffer
var profileFramebuffer; // The offscreen framebuffer.
var profileRenderbuffer; // The offscreen renderbuffer.
var profileColorBuffer; // The base memory to render to.  Probably doesn't need to be a texture
var profileProgram = [];

// The d3 objects for the profile curve
var profile_svg = null;
var profile_xScale = null;
var profile_yScale = null;
var profile_xAxis = null;
var profile_yAxis = null;
var profile_graph = null;

var profileData = [];  // This is the set of subdivided segments across tile boundaries that are the input to the render.
var profileGraphPoints = []; // This is the set of points that make up the actual profile graph.
var profileSlopePoints = []; // Two points selected for the slope calculation
var nSlopePoints = 0;
var slopeInitialized = false;
var slopeTooltip;
var xLimits = [];
var yLimits = [];
var curSlopeCursor = [];

// Data for the area rectangle and ellipse
var areaProgram = [];
var areaRectVertices = [];
var areaEllipseVertices = [];
var areaRectVertexBuffer = null;
var areaEllipseVertexBuffer = null;
var areaRectDefined = false;
var areaDefiningCorner = false;
var areaDraggingCorner = -1;
var areaDraggingRect = false;
var lastAreaLon, lastAreaLat;

var analysisLog = "";

// hack to see if I can get it to work
// change after proof of concept
//var counter_moon = new Counter(0, 2123366400);
//var counter_mars = new Counter(0, 129761280);
var counter = new Counter(0);
document.querySelector("#downloadProgress").value = 0;
counter.addEventListener("valuechange", (event) =>{
  document.querySelector("#downloadProgress").value = event.detail;
});
counter.addEventListener("downloadStart", (event) => {
  document.querySelector("#download").style.display = "block";
});
counter.addEventListener("downloadEnd", (event) => {
  document.querySelector("#download").style.display = "none";
});

function OnSettingsClose()
{
  document.getElementById("settingsForm").style.display="none";
}

function OnSettingsCancel()
{
  document.getElementById("settingsForm").style.display="none";
}

function selectBody(bodyData)
{
  curBodyData = bodyData;
  for (let i = 0; i < tileArray.length; i++)
    tileArray[i].releaseOpenGLBuffers(gl_hiRes);
  tileArray = [];
  fetchLowResMap(gl_nav, heightTex_nav);
  fetchLowResMap(gl_hiRes, previewTexObj);
  initBuffers_nav();
  initUniforms_nav(gl_nav);
  ClearPlots();
  drawScene_hiRes();
  drawScene_nav();
}


/**
 * Can we create our workers here?
 */
// const main_cwt = new Worker("./js/worker_checkPanelExist.js");
// const main_wwt = new Worker("./js/worker_main.js");

// main_wwt.onmessage = function(message){
//   const value1 = message.data.files;
//   const num_files = message.data.num_files;
//   console.log(value1);
//   console.log(num_files);
// }
// const main_rwt = new Worker('./js/worker_read.js');
/*
  main entry point
  1.) add 2 canvas
  2.) load webgl extensions
  3.) compile shaders
  4.) load textures
  5.) init attribute data
  6.) init uniform data
  7.) render nav canvas, high res canvas

*/
function mymain() {
  console.log("Starting...");

  addCanvas();

  // Initialize OpenGL with extensions on the first "navigation" canvas
  gl_nav = canvas_nav.getContext("webgl2");
  let float_textures_ext = gl_nav.getExtension("OES_texture_float_linear");
  float_textures_ext = gl_nav.getExtension("EXT_color_buffer_float");

  // Initialize OpenGL with extensions on the second "High-Res" canvas
  gl_hiRes = canvas_hiRes.getContext("webgl2");
  float_textures_ext = gl_hiRes.getExtension("OES_texture_float_linear");
  float_textures_ext = gl_hiRes.getExtension("EXT_color_buffer_float");
  anisotropy =
    gl_hiRes.getExtension("EXT_texture_filter_anisotropic") ||
    gl_hiRes.getExtension("MOZ_EXT_texture_filter_anisotropic") ||
    gl_hiRes.getExtension("WEBKIT_EXT_texture_filter_anisotropic");

  console.log(gl_nav);
  console.log(gl_hiRes);
  //////
  // fetch GLSL vertex and fragment source
  const vertexSource = fetch("./shaders/vert.glsl").then(function (response) {
    console.log("response object is returning vertex source ...");
    return response.text();
  });
  const fragSource = fetch("./shaders/frag.glsl").then(function (response) {
    console.log("response object is returning frag source ...");
    return response.text();
  });

  // 512 shaders
  const vertexSource_hiRes = fetch("./shaders/vert.glsl").then(function (
    response
  ) {
    console.log("response object is returning vertex source -- hiRes ...");
    return response.text();
  });
  const fragSource_hiRes = fetch("./shaders/frag.glsl").then(function (
    response
  ) {
    console.log("response object is returning frag source -- hiRes ...");
    return response.text();
  });
  const shaderSource = { vsrc: {}, fsrc: {} };
  const shaderSource_hiRes = { vsrc: {}, fsrc: {} };

  // load source into arrays for compiling
  Promise.all([vertexSource, fragSource, vertexSource_hiRes, fragSource_hiRes])
    .then(function (sourcesText) {
      console.log("===Resolved Promise.all====");
      shaderSource["vsrc"] = sourcesText[0];
      shaderSource["fsrc"] = sourcesText[1];
      shaderSource_hiRes["vsrc"] = sourcesText[2];
      shaderSource_hiRes["fsrc"] = sourcesText[3];
    })
    .then(function () {
      gpuProgram_nav = makeShaders(shaderSource, gl_nav);
      gl_nav.useProgram(gpuProgram_nav);
      initShaderVariables(gl_nav, gpuProgram_nav);
      initUniforms_nav(gpuProgram_nav);
      // gridProgram_nav = makeGridShaders(gl_nav);
      // pathProgram_hiRes = makeLineShaders_hiRes(gl_hiRes);
      // profileProgram = makeProfileShaders_hiRes(gl_hiRes);
      gridProgram_nav = makeShaders({"vsrc": lineVertSource, "fsrc": lineFragSource}, gl_nav);
      pathProgram_hiRes = makeShaders({"vsrc": lineVertSource, "fsrc": lineFragSource}, gl_hiRes);
      profileProgram = makeShaders({"vsrc": profileVertSource, "fsrc": profileFragSource}, gl_hiRes);
      bannerProgram_hiRes = makeShaders({"vsrc": bannerVertSource, "fsrc": bannerFragSource}, gl_hiRes);

      // hiRes
      gpuProgram_hiRes = makeShaders(shaderSource_hiRes, gl_hiRes);
      gl_hiRes.useProgram(gpuProgram_hiRes);
      initShaderVariables(gl_hiRes, gpuProgram_hiRes);
      initUniforms_hiRes(gpuProgram_hiRes);

      console.log(gpuProgram_nav);
      console.log(gpuProgram_hiRes);
      initHeigthTexture_nav();
      initBuffers_nav();

      initializeToolBuffers();

      // Maybe we only want to do this for last panel used in the last session so that we know that it is resident
        panelKey(0, 0, DpanelHeightLat(), DpanelWidthLon());
         
    })
    .then(function () {
      drawloop();
    });

  // render function
  function drawloop() {
    gl_nav.clear(gl_nav.COLOR_BUFFER_BIT | gl_nav.DEPTH_BUFFER_BIT);
    gl_nav.clearColor(0.0, 0.0, 0.0, 1.0); // black is clear color
    gl_nav.enable(gl_nav.DEPTH_TEST); // may not need this
    gl_nav.enable(gl_nav.SCISSOR_TEST);

    gl_hiRes.clear(gl_hiRes.COLOR_BUFFER_BIT | gl_hiRes.DEPTH_BUFFER_BIT);
    gl_hiRes.clearColor(0.0, 0.0, 0.0, 1.0); // black is clear color
    gl_hiRes.enable(gl_hiRes.DEPTH_TEST); // may not need this
    gl_hiRes.enable(gl_hiRes.SCISSOR_TEST);

    drawScene_nav(gl_nav);
    drawScene_hiRes(gl_hiRes);
    requestAnimationFrame(drawloop);
    // await new Promise(r => setTimeout(r, 100)); // Pause to avoid 100% gpu usage with a single instance of this!
  }
  /////
}

function computeInscribedEllipse()
{
  if (areaRectVertices.length > 0)
  {
    var lonMin, lonMax, latMin, latMax;

    lonMin = lonMax = areaRectVertices[0]; // Remember, x = longitude
    latMin = latMax = areaRectVertices[1];
  
    lonMin = Math.min(lonMin, Math.min(Math.min(areaRectVertices[3], areaRectVertices[6]), areaRectVertices[9])); // Assume that the last vertex equals the first
    latMin = Math.min(latMin, Math.min(Math.min(areaRectVertices[4], areaRectVertices[7]), areaRectVertices[10])); // Assume that the last vertex equals the first
    lonMax = Math.max(lonMin, Math.max(Math.max(areaRectVertices[3], areaRectVertices[6]), areaRectVertices[9])); // Assume that the last vertex equals the first
    latMax = Math.max(latMin, Math.max(Math.max(areaRectVertices[4], areaRectVertices[7]), areaRectVertices[10])); // Assume that the last vertex equals the first
  
    var lonAxis = (lonMax - lonMin) / 2.0;
    var latAxis = (latMax - latMin) / 2.0;
    var centerLon = (lonMax + lonMin) / 2.0;
    var centerLat = (latMax + latMin) / 2.0;
  
    areaEllipseVertices = [];
    for (let theta = 0; theta < 2.0 * Math.PI; theta += .01)
    {
      areaEllipseVertices.push(centerLon + Math.cos(theta) * lonAxis);
      areaEllipseVertices.push(centerLat + Math.sin(theta) * latAxis);
      areaEllipseVertices.push(0.4);
    }
  }
}

/**
 * This appends text to the log window and should be used to write out
 * results from the measurements and other diagnostics like latitude/longitude
 * chosen.
 */
function LogPrint(message, indent=0, color="white")
{
  let logDiv = document.getElementById("logText_div");
  logDiv.innerHTML += "<span style='margin-left:" + indent + "px; color=" + color + "'>" + message + "<br/>";
  logDiv.scrollTop = logDiv.scrollHeight;  
  analysisLog += message + "\n";
}

function LogNewParagraph()
{
  let logDiv = document.getElementById("logText_div");
  logDiv.innerHTML += "<p class='log'>";
  logDiv.scrollTop = logDiv.scrollHeight;  
  analysisLog += "\n";
}

async function LogExport()
{
  var csvData = 'lon,lat,Elevation\n';
  for (var latID = latStartIndex; latID <= latEndIndex; latID++)
  {
    for (let lonID = lonStartIndex; lonID <= lonEndIndex; lonID++)
    {
      csvData += (tile.longitude_min + lonID * deltaLon) + ',' +                        // x
                (tile.latitude_min + latID * deltaLat) + ',' +                         // y
                (tile.image_data[tile.columns * (tile.rows - latID) + lonID]) + '\n';    // z, remember that the file stores .5m units ... 
    }
  }
  var blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);

  let logDiv = document.getElementById("logText_div");
  const handle = await showSaveFilePicker({
    suggestedName: fileName,
    startIn: "downloads",
    types: [{
        description: "Text file",
        accept: {'text': ['.txt']},
    }],
  });
  
  // Create a link to download it
  // WARNING: for the moment, this will only save to "downloads"
  // this appears to be a limitation of https to only save to standard
  // well-known folders, but I also cannot read the path from the 
  // output of showSaveFilePicker
  var pom = document.createElement('a');
  pom.href = url;

  pom.setAttribute('download', handle.name); // "rectangleExport.csv");
  pom.click();
}

/**
 * adds a webgl canvas to our html page
 * get body tag
 *  - append div nav
 *      * append nav canvas
 *  - append div high resolution
 *      * append high resolution canvas
 *
 */
function addCanvas() {
  let body = document.querySelector("body");
  let grid = document.getElementById("grid");

  // body.style.border = "1px solid red";

  document.getElementById("imgDownload").setAttribute("style", "display:none");
  document.getElementById("imgAreaThreeD").setAttribute("style", "display:none");

  document
    .getElementById("imgNavigation")
    .setAttribute(
      "style",
      "opacity:1.0; -moz-opacity:1.0; filter:alpha(opacity=100)"
    );

  // div nav
  let div_tag = document.createElement("div");
  div_tag.id = "nav_div";
  div_tag.className = "navigation";
  div_tag.margin = 10;
  grid.appendChild(div_tag);

  // nav canvas
  div_tag = document.querySelector("#nav_div");
  var navHeader = document.createElement("h3");
  navHeader.innerHTML = "Navigation panel";
  div_tag.appendChild(navHeader);

  canvas_nav = document.createElement("canvas");
  canvas_nav.style.position = "relative";
  canvas_nav.id = "nav";
  canvas_nav.width = 600;
  canvas_nav.height = 300;
  canvas_nav.display = "block";
  div_tag.appendChild(canvas_nav);

  //div high resolution
  div_tag = document.createElement("div");
  div_tag.id = "highres_div";
  div_tag.className = "highres";
  div_tag.margin = 10;
  grid.appendChild(div_tag);

  // high resolution canvas
  div_tag = document.querySelector("#highres_div");
  canvas_hiRes = document.createElement("canvas");
  canvas_hiRes.style.position = "relative";
  canvas_hiRes.id = "highres";
  canvas_hiRes.display = "block";
  canvas_hiRes.width = 1200;
  canvas_hiRes.height = 600;
  div_tag.appendChild(canvas_hiRes);

  var div_graph = document.createElement("div");
  div_graph.id = "graph_div";
  div_graph.className = "plots";
  div_graph.margin = 10;
  grid.appendChild(div_graph);

  CreateProfileGraph([]);

  imgCoordinates.addEventListener("click", (event) => {
    var coordStr = prompt(
      "Enter coordinates in the form (latitude, longitude):"
    );

    if (coordStr != "") {
      var coordArray = coordStr.split(",");
      var latitude = Number(coordArray[0]);
      var longitude = Number(coordArray[1]);
      
      console.log(
        "Chosen quarter-panel number: " +
          panelKey(latitude, longitude, DpanelHeightLat(), DpanelWidthLon())
      ); // These are moon latitude/longitude ranges for 512ppd maps
   
    }
  });

  document.getElementById("selectMoon").addEventListener("input", (event) => {
    selectBody(moonData);
  });

  document.getElementById("selectMars").addEventListener("input", (event) => {
    selectBody(marsData);
  });

  document.getElementById("reliefStrength").addEventListener("input", (event) => {
    moonData.hiresReliefScale = document.getElementById("reliefStrength").value;
    marsData.hiresReliefScale = document.getElementById("reliefStrength").value;
    drawScene_hiRes();
  });

  document.getElementById("monochrome").addEventListener("input", (event) => {
    moonData.useMono = true;
    marsData.useMono = true;
    drawScene_hiRes();
  });

  document.getElementById("falsecolor").addEventListener("input", (event) => {
    moonData.useMono = false;
    marsData.useMono = false;
    drawScene_hiRes();
  });

  imgSettings.addEventListener("click", (event) => {
    var settingsForm = document.getElementById("settingsForm");

    // If the settings window is not displayed then set the values of the controls from the current 
    // body's data and display it.  If it is displayed, then hide it and apply the settings.
    if (settingsForm.style.display == "none" || settingsForm.style.display == "")
      settingsForm.style.display = "block";
    else
    {
      settingsForm.style.display = "none";
      curBodyData.hiresReliefScale = document.getElementById("reliefStrength").value;
    }
  })

  imgNavigation.addEventListener("click", (event) => {
    curMode = navMode;
    document
      .getElementById("imgNavigation")
      .setAttribute(
        "style",
        "opacity:1.0; -moz-opacity:1.0; filter:alpha(opacity=100)"
      );
    document
      .getElementById("imgProfile")
      .setAttribute(
        "style",
        "opacity:0.75; -moz-opacity:0.75; filter:alpha(opacity=75)"
      );
    document
      .getElementById("imgArea")
      .setAttribute(
        "style",
        "opacity:0.75; -moz-opacity:0.75; filter:alpha(opacity=75)"
      );
    rendering3D = false;
  });

  imgProfile.addEventListener("click", (event) => {
    curMode = profileMode;
    document
      .getElementById("imgNavigation")
      .setAttribute(
        "style",
        "opacity:0.75; -moz-opacity:0.75; filter:alpha(opacity=75)"
      );
    document
      .getElementById("imgProfile")
      .setAttribute(
        "style",
        "opacity:1.0; -moz-opacity:1.0; filter:alpha(opacity=100)"
      );
    document
      .getElementById("imgArea")
      .setAttribute(
        "style",
        "opacity:0.75; -moz-opacity:0.75; filter:alpha(opacity=75)"
      );
    rendering3D = false;
  });

  imgArea.addEventListener("click", (event) => {
    curMode = areaMode;
    document
      .getElementById("imgNavigation")
      .setAttribute(
        "style",
        "opacity:0.75; -moz-opacity:0.75; filter:alpha(opacity=75)"
      );
    document
      .getElementById("imgProfile")
      .setAttribute(
        "style",
        "opacity:0.75; -moz-opacity:0.75; filter:alpha(opacity=75)"
      );
    document
      .getElementById("imgArea")
      .setAttribute(
        "style",
        "opacity:1.0; -moz-opacity:1.0; filter:alpha(opacity=100)"
      );
    rendering3D = false;
  });

  imgMars.addEventListener("click", (event) => {
    selectBody(marsData);
  });

  imgMoon.addEventListener("click", (event) => {
    selectBody(moonData);
  });

  imgDownload.addEventListener("click", (event) => {
    SaveRectangle();
  });

  imgAreaThreeD.addEventListener("click", (event) => {
    rendering3D = !rendering3D;
    setupAreaMesh(gl_hiRes);
    drawScene_hiRes();
  });

  canvas_nav.addEventListener("click", (event) => {
    if (event.button == 0)
    {
      const rect = canvas_nav.getBoundingClientRect();
      var longitude = ((event.clientX - rect.left) / rect.width) * 360.0;
      var latitude =
        (1.0 - (event.clientY - rect.top) / rect.height) * 180.0 - 90.0;
      console.log("Nav window clicked: " + longitude + ", " + latitude);
  
       // need to change 90 to 88 or 90 for Mars/Moon JM
       let latitude_Factor = 90;
       if(curBodyData.datasetName === "MOLA"){
          latitude_Factor = 88;
       }
      
       var panelOrigin = [
              Math.floor(longitude / DpanelWidthLon() ) * DpanelWidthLon() ,
              Math.floor((latitude + latitude_Factor) /  DpanelHeightLat() ) * DpanelHeightLat() - latitude_Factor/2
            ];
   
  
      mouse_click_longitude = longitude;
      mouse_click_latitude = latitude;
  
      console.log(
        "Quarter panel chosen: (" +
          panelOrigin[0] +
          " -> " +
          (panelOrigin[0] + DpanelWidthLon() ) +
          ", " +
          panelOrigin[1] +
          " -> " +
          (panelOrigin[1] + DpanelHeightLat() ) +
          ")"
      );
      console.log(
        "Panel Key: " +
          panelKey(latitude, longitude, DpanelHeightLat(), DpanelWidthLon() )
      );
      initTextures_hiRes(
        panelKey(latitude, longitude, DpanelHeightLat(), DpanelWidthLon() )
      );
      rendering3D = false;
    }
  });

  // This stuff should go in the constructor of the canvas webgl display class.
  canvas_hiRes.addEventListener("mousedown", (event) => {
    if (event.button == 0)
    {
      if (curMode == navMode) {
        lastMouseLoc_hiRes = [event.clientX, event.clientY];
        zoomCenterX = event.clientX;
        zoomCenterY = event.clientY;
        if (event.shiftKey) zooming_hiRes = true;
        else panning_hiRes = true;
      } else if (curMode == profileMode) {
        const rect = canvas_hiRes.getBoundingClientRect();
        var viewLonMin = viewCenter_hiRes[0] - viewSize_hiRes * 2;
        var viewLatMin = viewCenter_hiRes[1] - viewSize_hiRes;
        var longitude =
          ((event.clientX - rect.left) / rect.width) * viewSize_hiRes * 4 +
          viewLonMin;
        var latitude =
          (1.0 - (event.clientY - rect.top) / rect.height) * viewSize_hiRes * 2 +
          viewLatMin;
  
        pathPointMoving = -1;
        for (let i = 0; i < pathVerts.length / 3; i++) {
          var distLatLon = Math.sqrt(
            (longitude - pathVerts[3 * i]) ** 2 +
              (latitude - pathVerts[3 * i + 1]) ** 2
          );
          var distScreen = (distLatLon / viewSize_hiRes) * rect.height;
          // console.log("Distance: " + distScreen)
          if (distScreen < 10) {
            pathPointMoving = i;
            break;
          }
        }
  
        if (pathPointMoving == -1) {
          if (pathVerts.length == 0) {
            // If we don't have any, push the first one twice, so we have a line
            pathVerts.push(longitude, latitude, 0.1);
            firstPathPointMoved = false;
          }
          if (pathVerts.length < 6)
          {
            pathVerts.push(longitude, latitude, 0.1);
            pathPointMoving = pathVerts.length / 3 - 1;
          }
        }
      } else if (curMode == areaMode) {
        if (!rendering3D)
        {
          const rect = canvas_hiRes.getBoundingClientRect();
          var viewLonMin = viewCenter_hiRes[0] - viewSize_hiRes * 2;
          var viewLatMin = viewCenter_hiRes[1] - viewSize_hiRes;
          var longitude =
            ((event.clientX - rect.left) / rect.width) * viewSize_hiRes * 4 +
            viewLonMin;
          var latitude =
            (1.0 - (event.clientY - rect.top) / rect.height) * viewSize_hiRes * 2 +
            viewLatMin;
    
          if (!areaRectDefined)
          {
            areaRectVertices = [
              longitude,
              latitude,
              0.4,
              longitude,
              latitude,
              0.4,
              longitude,
              latitude,
              0.4,
              longitude,
              latitude,
              0.4,
              longitude,
              latitude,
              0.4,
            ];
    
            document.getElementById("imgDownload").setAttribute("style", "display:block");
            document.getElementById("imgAreaThreeD").setAttribute("style", "display:block");
            areaRectDefined = true;
            areaDefiningCorner = true;
          }
          else
          {
            for (let i = 0; i < 3; i++)
            {
              var distLatLon = Math.sqrt(
                (longitude - areaRectVertices[3*i]) ** 2 +
                (latitude - areaRectVertices[3 * i + 1]) ** 2
              );
              var distScreen = (distLatLon / viewSize_hiRes) * rect.height;
              // console.log("Distance: " + distScreen)
              if (distScreen < 10) {
                areaDraggingCorner = i;
                break;
              }
            }
            
            if ((areaDraggingCorner == -1) && (longitude > areaRectVertices[0]) && (longitude < areaRectVertices[6]) && (latitude > areaRectVertices[1]) && (latitude < areaRectVertices[7]))
            {
              areaDraggingRect = true;
              lastAreaLon = longitude;
              lastAreaLat = latitude;
    ``      }
          }
        }
        else
        {
          if (event.shiftKey) 
            zooming3D = true;
          else
            rotating3D = true;
          lastMouseLoc_hiRes = [event.clientX, event.clientY];
        }
      }
    }
  });

  canvas_hiRes.addEventListener("mousemove", (event) => {
    if (event.button == 0)
    {
      if (curMode == navMode) {
        // Record the current latitude and longitude of the cursor for the current data banner.
        const rect = canvas_hiRes.getBoundingClientRect();
        var viewLonMin = viewCenter_hiRes[0] - viewSize_hiRes * 2;
        var viewLatMin = viewCenter_hiRes[1] - viewSize_hiRes;
        bannerCurLon = ((event.clientX - rect.left) / rect.width) 
                        * viewSize_hiRes * 4 
                        + viewLonMin;
        bannerCurLat = (1.0 - (event.clientY - rect.top) / rect.height) 
                        * viewSize_hiRes * 2 +
                        viewLatMin;      
        if (panning_hiRes) {
          var disp = [
            (event.clientX - lastMouseLoc_hiRes[0]) / 100.0,
            (event.clientY - lastMouseLoc_hiRes[1]) / 100.0,
          ];
          viewCenter_hiRes[0] -= disp[0] * panRate_hiRes;
          viewCenter_hiRes[1] += disp[1] * panRate_hiRes; // remember, Y is inverted.
          // ToDo: Limit the movement to the current panel.   
          lastMouseLoc_hiRes = [event.clientX, event.clientY];
        } else if (zooming_hiRes) {
          zoomViewAboutCursor(zoomCenterX, zoomCenterY, (event.clientY - lastMouseLoc_hiRes[1]) / 100.0);
          // var amount = (event.clientY - lastMouseLoc_hiRes[1]) / 100.0;
          // viewSize_hiRes *= 1 + amount * zoomRate_hiRes;
          // if (viewSize_hiRes > DpanelHeightLat() / 2)
          // {
          //   viewSize_hiRes = DpanelHeightLat() / 2;
          // }
          // panRate_hiRes = viewSize_hiRes / 2;
          lastMouseLoc_hiRes = [event.clientX, event.clientY];
        }
      } else if (curMode == profileMode) {
        if (pathPointMoving >= 0) {
          const rect = canvas_hiRes.getBoundingClientRect();
          var viewLonMin = viewCenter_hiRes[0] - viewSize_hiRes * 2;
          var viewLatMin = viewCenter_hiRes[1] - viewSize_hiRes;
          var longitude =
            ((event.clientX - rect.left) / rect.width) * viewSize_hiRes * 4 +
            viewLonMin;
          var latitude =
            (1.0 - (event.clientY - rect.top) / rect.height) *
              viewSize_hiRes *
              2 +
            viewLatMin;
  
          firstPathPointMoved = true;
  
          pathVerts[3 * pathPointMoving] = longitude;
          pathVerts[3 * pathPointMoving + 1] = latitude;
          drawScene_hiRes();
          renderHeightProfile(gl_hiRes, 1024);
        }
      } else if (curMode == areaMode) {
        if (!rendering3D)
        {
          const rect = canvas_hiRes.getBoundingClientRect();
          var viewLonMin = viewCenter_hiRes[0] - viewSize_hiRes * 2;
          var viewLatMin = viewCenter_hiRes[1] - viewSize_hiRes;
          var longitude =
            ((event.clientX - rect.left) / rect.width) * viewSize_hiRes * 4 +
            viewLonMin;
          var latitude =
            (1.0 - (event.clientY - rect.top) / rect.height) * viewSize_hiRes * 2 +
            viewLatMin;
    
          if (areaDefiningCorner)
          {
            areaRectVertices[3] = longitude;
            areaRectVertices[6] = longitude;
            areaRectVertices[7] = latitude;
            areaRectVertices[10] = latitude;
    
            computeInscribedEllipse();
    
            drawScene_hiRes();
          }
          else if (areaDraggingCorner >= 0)
          {
            if (areaDraggingCorner == 0)
            {
              areaRectVertices[0] = longitude;
              areaRectVertices[1] = latitude;
              areaRectVertices[4] = latitude;
              areaRectVertices[9] = longitude;
              areaRectVertices[12] = longitude;
              areaRectVertices[13] = latitude;
            }
            else if (areaDraggingCorner == 1)
            {
              areaRectVertices[1] = latitude;
              areaRectVertices[3] = longitude;
              areaRectVertices[4] = latitude;
              areaRectVertices[6] = longitude;
              areaRectVertices[13] = latitude;
            }
            else if (areaDraggingCorner == 2)
            {
              areaRectVertices[3] = longitude;
              areaRectVertices[6] = longitude;
              areaRectVertices[7] = latitude;
              areaRectVertices[10] = latitude;
            }
            else if (areaDraggingCorner = 3)
            {
              areaRectVertices[0] = longitue;
              areaRectVertices[7] = latitude;
              areaRectVertices[9] = longitude;
              areaRectVertices[10] = latitude;
              areaRectVertices[12] = longitude;
            }
    
            computeInscribedEllipse();
    
            drawScene_hiRes();
          }
          else if (areaDraggingRect)
          {
            const deltaLon = longitude - lastAreaLon;
            const deltaLat = latitude - lastAreaLat;
    
            //alert("deltaLon = " + deltaLon + ", deltaLat = " + deltaLat);
    
            areaRectVertices[0] += deltaLon;
            areaRectVertices[3] += deltaLon;
            areaRectVertices[6] += deltaLon;
            areaRectVertices[9] += deltaLon;
            areaRectVertices[12] += deltaLon;
    
            areaRectVertices[1] += deltaLat;
            areaRectVertices[4] += deltaLat;
            areaRectVertices[7] += deltaLat;
            areaRectVertices[10] += deltaLat;
            areaRectVertices[13] += deltaLat;
    
            lastAreaLon = longitude;
            lastAreaLat = latitude;
    
            computeInscribedEllipse();
    
            drawScene_hiRes();
          }
        }
        else if (rotating3D)  // We are drawing 3D so rotate the camera
        {
          var distX = event.clientX - lastMouseLoc_hiRes[0];
          threeD_azimuth -= distX / 10.0;
          var distY = event.clientY - lastMouseLoc_hiRes[1];
          threeD_altitude = Math.min(Math.max(threeD_altitude + distY / 10.0, -89.9), 89.9);
          //alert("Rotating by " + event.clientX + " degrees");
          lastMouseLoc_hiRes = [event.clientX, event.clientY];
          drawScene_hiRes();
        }
        else if (zooming3D)
        {
          var distY = event.clientY - lastMouseLoc_hiRes[1];
          threeD_fov = threeD_fov / (1.0 - distY / 1000.0);
          lastMouseLoc_hiRes = [event.clientX, event.clientY];
          drawScene_hiRes();
        }
      }
    }
  });

  canvas_hiRes.addEventListener("mouseup", (event) => {
    if (event.button == 0)
    {
      if (curMode == navMode) {
        panning_hiRes = zooming_hiRes = false;
        zooming_hiRes = false;
      }
      if (curMode == profileMode) {
        pathPointMoving = -1;
        if (!firstPathPointMoved) {
          // If we are defining the first path point, and have not moved the mouse (i.e. just clicked)
          // then that first point will be doubled and can cause a phantom edge.  So, remove it.
          pathVerts.pop();
          pathVerts.pop();
          pathVerts.pop();
          firstPathPointMoved = true;
        }
        drawScene_hiRes();
        renderHeightProfile(gl_hiRes, 1024);
  
        LogNewParagraph();
        LogPrint("Profile:");
        let elev1 = getHeightFromTileArray(pathVerts[1], pathVerts[0]);  // pathVerts is a 1d array of triples
        let elev2 = getHeightFromTileArray(pathVerts[4], pathVerts[3]);  // pathVerts is a 1d array of triples
        LogPrint("Endpoint 1, [Lat: " + (pathVerts[1]).toFixed(2) + ", Lon: " + (pathVerts[0]).toFixed(2) + ", Elev: " + elev1.toFixed(2) + "]", 
                 12, "yellow");
        LogPrint("Endpoint 2, [Lat: " + (pathVerts[4]).toFixed(2) + ", Lon: " + (pathVerts[3]).toFixed(2) + ", Elev: " + elev2.toFixed(2) + "]", 
                 12, "yellow");
      }
      if (curMode == areaMode)
      {
        if (!rendering3D)
        {
          // Reorder the rectangle vertices to make the first vertex the minimums and the third vertex are the maximums
          var lonMin, lonMax, latMin, latMax;
    
          lonMin = lonMax = areaRectVertices[0]; // Remember, x = longitude
          latMin = latMax = areaRectVertices[1];
    
          lonMin = Math.min(lonMin, Math.min(Math.min(areaRectVertices[3], areaRectVertices[6]), areaRectVertices[9])); // Assume that the last vertex equals the first
          latMin = Math.min(latMin, Math.min(Math.min(areaRectVertices[4], areaRectVertices[7]), areaRectVertices[10])); // Assume that the last vertex equals the first
          lonMax = Math.max(lonMin, Math.max(Math.max(areaRectVertices[3], areaRectVertices[6]), areaRectVertices[9])); // Assume that the last vertex equals the first
          latMax = Math.max(latMin, Math.max(Math.max(areaRectVertices[4], areaRectVertices[7]), areaRectVertices[10])); // Assume that the last vertex equals the first
    
          areaRectVertices = [
            lonMin,
            latMin,
            0.4,
            lonMax,
            latMin,
            0.4,
            lonMax,
            latMax,
            0.4,
            lonMin,
            latMax,
            0.4,
            lonMin,
            latMin,
            0.4,
          ];
    
          areaDefiningCorner = false;
          areaDraggingCorner = -1;
          areaDraggingRect = false;
          
          computeInscribedEllipse();
        }
        else
        {
          rotating3D = false;
          zooming3D = false;
        }
      }
    }
  });

  function zoomViewAboutCursor(x, y, amount)
  {
    const rect = canvas_hiRes.getBoundingClientRect();
    var lonMin = viewCenter_hiRes[0] - viewSize_hiRes * 2;
    var latMin = viewCenter_hiRes[1] - viewSize_hiRes;
    var lon =
      ((x - rect.left) / rect.width) * viewSize_hiRes * 4 +
      lonMin;
    var lat =
      (1.0 - (y - rect.top) / rect.height) * viewSize_hiRes * 2 +
      latMin;

    var lonMax = viewCenter_hiRes[0] + viewSize_hiRes * 2;
    var latMax = viewCenter_hiRes[1] + viewSize_hiRes;

    var lonMaxPercent = (lonMax - lon) / (viewSize_hiRes * 2);
    var latMaxPercent = (latMax - lat) / (viewSize_hiRes);
    var lonMinPercent = (lon - lonMin) / (viewSize_hiRes * 2);
    var latMinPercent = (lat - latMin) / (viewSize_hiRes);

    viewSize_hiRes *= 1 + amount * zoomRate_hiRes;
    if (viewSize_hiRes > DpanelHeightLat() / 2)
    {
      viewSize_hiRes = DpanelHeightLat() / 2;
    }
    panRate_hiRes = viewSize_hiRes / 2;

    lonMin = lon - lonMinPercent * viewSize_hiRes * 2;
    latMin = lat - latMinPercent * viewSize_hiRes;
    lonMax = lon + lonMaxPercent * viewSize_hiRes * 2;
    latMax = lat + latMaxPercent * viewSize_hiRes;

    viewCenter_hiRes[0] = (lonMax + lonMin) / 2;
    viewCenter_hiRes[1] = (latMax + latMin) / 2;
  }

  canvas_hiRes.addEventListener("wheel", (event) => {
    if (curMode == navMode) {
      event.preventDefault();

      zoomViewAboutCursor(event.clientX, event.clientY, event.deltaY / 1000.0);
      event.stopPropagation();
    }
    else if (rendering3D)  // We are drawing 3D so rotate the camera
    {
      event.preventDefault();
      threeD_fov = threeD_fov / (1.0 - event.deltaY / 2000.0);
      drawScene_hiRes();
      event.stopPropagation();
    }

  });

  canvas_hiRes.addEventListener("dblclick", (event) => {
    if (curMode == profileMode) {
      pathVerts = [];
      drawScene_hiRes();
    }
    else if (curMode == areaMode)
    {
      const rect = canvas_hiRes.getBoundingClientRect();
      var viewLonMin = viewCenter_hiRes[0] - viewSize_hiRes * 2;
      var viewLatMin = viewCenter_hiRes[1] - viewSize_hiRes;
      var longitude =
        ((event.clientX - rect.left) / rect.width) * viewSize_hiRes * 4 +
        viewLonMin;
      var latitude =
        (1.0 - (event.clientY - rect.top) / rect.height) * viewSize_hiRes * 2 +
        viewLatMin;

      if ((longitude > areaRectVertices[0]) && (longitude < areaRectVertices[6]) && (latitude > areaRectVertices[1]) && (latitude < areaRectVertices[7]))
      {
        PrintAreaStatistics();
      }
      else
      {
        // Clear the rectangle and set the defined flag to false;
        areaRectVertices = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        areaEllipseVertices = [];
        document.getElementById("imgDownload").setAttribute("style", "display:none");
        document.getElementById("imgAreaThreeD").setAttribute("style", "display:none");
        areaRectDefined = false;
        drawScene_hiRes();
      }
    }
    else if (curMode == navMode)
    {
      // Load the quarter-panel that is under the cursor.  Note that we might want to leave the view static in this case, meaning that 
      // we'd need a flag in the loading code to leave the view alone.  This is in contrast to the nav window where when we select 
      // a panel, it resets the view to the center of the panel and covering precisely it's size.      
    } 
  });

  // This alatg with the "stopPropogation" should disable the mouse wheel for scrolling the page
  // but its not working.
  body.addEventListener("wheel", (event) => {
    event.preventDefault();
    return;
  });

  // This is an attempt to resize the display based on the window size.
  window.addEventListener("resize", (event) => {
    console.log("Resize event: " + body.clientWidth);
    //canvas_hiRes.width = body.clientWidth;
    //canvas_hiRes.height = body.clientWidth / 2;
  });

  window.addEventListener("keydown", (event) => {
    if (event.altKey && (event.key == "a"))
    {
      PrintAreaStatistics();
    }
    else if (event.altKey && (event.key == "s")) // Save file
    {
      SaveRectangle();
    }
  })
}

function PrintAreaStatistics()
{
  if (areaRectDefined)
  {
    var coords = [
        { lat: areaRectVertices[1], lng: areaRectVertices[0] },
        { lat: areaRectVertices[4], lng: areaRectVertices[3] },
        { lat: areaRectVertices[7], lng: areaRectVertices[6] },
        { lat: areaRectVertices[10], lng: areaRectVertices[9] }          
    ];
    
    // convert the list to a list of LatLng objects
    var latLngs = coords.map(function(coord) {
      return new LatLng(coord.lat, coord.lng);
    });

    var area = computeArea(latLngs);

    coords = [];
    for (let i = 0; i < areaEllipseVertices.length; i+=3)
      coords.push({lat: areaEllipseVertices[i+1], lng: areaEllipseVertices[i]});

    latLngs = coords.map(function(coord) {
      return new LatLng(coord.lat, coord.lng);
    });
    var ellipseArea = computeArea(latLngs);
    var ellipseData = HeightStatisticsInEllipse(1.0 / 256.0);  // two pixels buffer on border given 512ppd

    LogNewParagraph();
    LogPrint("Selected Rectangle: ");
    LogPrint("Lower Left: " + "[Lat: " + Math.min(areaRectVertices[1], areaRectVertices[7]).toFixed(2) + 
                            ", Lon: " + Math.min(areaRectVertices[0], areaRectVertices[6]).toFixed(2) + "]", 12);
    LogPrint("Upper Right: " + "[Lat: " + Math.max(areaRectVertices[1], areaRectVertices[7]).toFixed(2) + 
                          ", Lon: " + Math.max(areaRectVertices[0], areaRectVertices[6]).toFixed(2) + "]", 12);
    LogPrint("Box Area = " + (area / 1000000).toFixed(2) + " km^2", 12); 
    LogPrint("Ellipse Area = " + (ellipseArea / 1000000).toFixed(2) + " km^2", 12); 
    LogPrint("Ellipse Volume (relative to average edge elevation) = " + Math.abs(ellipseArea * (ellipseData.aveEdgeHeight - ellipseData.aveHeight) / 1000000000).toFixed(2) + " km^3", 12);

    // alert("Box Area = " + (area / 1000000).toFixed(2) + " km^2" + 
    //       "\nEllipse Area = " + (ellipseArea / 1000000).toFixed(2) + " km^2" + 
    //       "\nEllipse Volume (relative to average edge elevation) = " + (ellipseArea * (ellipseData.aveEdgeHeight - ellipseData.aveHeight) / 1000000000).toFixed(2) + " km^3");

      // "\nLongitudeDiff = " + (areaRectVertices[3] - areaRectVertices[0]).toFixed(2) + 
      // "\nLatitudeDiff = " + (areaRectVertices[7] - areaRectVertices[4]).toFixed(2) + 
      // "\nLatitudeAve = " + ((areaRectVertices[7] + areaRectVertices[4]).toFixed(2) / 2));
  }
  else
    alert("Please define an area rectangle before asking to compute area");
}

async function SaveRectangle()
{
  if (areaRectVertices.length > 0) 
  {
    var lonMin = Math.min(Math.min(Math.min(areaRectVertices[0], areaRectVertices[3]), areaRectVertices[6]), areaRectVertices[9]);
    var lonMax = Math.max(Math.max(Math.max(areaRectVertices[0], areaRectVertices[3]), areaRectVertices[6]), areaRectVertices[9]);

    var latMin = Math.min(Math.min(Math.min(areaRectVertices[1], areaRectVertices[4]), areaRectVertices[7]), areaRectVertices[10]);
    var latMax = Math.max(Math.max(Math.max(areaRectVertices[1], areaRectVertices[4]), areaRectVertices[7]), areaRectVertices[10]);

    for (let i = 0; i < tileArray.length; i++)
    {
      var tile = tileArray[i];
      if ((tile.longitude_min < lonMax) && (tile.longitude_max > lonMin) && (tile.latitude_min < latMax) && (tile.latitude_max > latMin))
      {
        var lonStart = Math.max(tile.longitude_min, lonMin);
        var lonEnd = Math.min(tile.longitude_max, lonMax);
        var latStart = Math.max(tile.latitude_min, latMin);
        var latEnd = Math.min(tile.latitude_max, latMax);

        var deltaLon = (tile.longitude_max - tile.longitude_min) / tile.columns;
        var deltaLat = (tile.latitude_max - tile.latitude_min) / tile.rows;
        var lonStartIndex = Math.ceil((lonStart - tile.longitude_min) / deltaLon);
        var latStartIndex = Math.ceil((latStart - tile.latitude_min) / deltaLat);
        var lonEndIndex = Math.floor((lonEnd - tile.longitude_min) / deltaLon);
        var latEndIndex = Math.floor((latEnd - tile.latitude_min) / deltaLat);

        var csvData = 'lon,lat,Elevation\n';
        for (var latID = latStartIndex; latID <= latEndIndex; latID++)
        {
          for (let lonID = lonStartIndex; lonID <= lonEndIndex; lonID++)
          {
            csvData += (tile.longitude_min + lonID * deltaLon) + ',' +                        // x
                      (tile.latitude_min + latID * deltaLat) + ',' +                         // y
                      (tile.image_data[tile.columns * (tile.rows - latID) + lonID]) + '\n';    // z, remember that the file stores .5m units ... 
          }
        }
        var blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);

        var fileName = "lola_(" + latStart.toFixed(2) + "_" + lonStart.toFixed(2) + ")_(" + latEnd.toFixed(2) + "_" + lonEnd.toFixed(2) + ").csv"

        const handle = await showSaveFilePicker({
          suggestedName: fileName,
          startIn: "downloads",
          types: [{
              description: "Comma delimited file",
              accept: {'text/csv': ['.csv']},
          }],
        });
        
        // Create a link to download it
        // WARNING: for the moment, this will only save to "downloads"
        // this appears to be a limitation of https to only save to standard
        // well-known folders, but I also cannot read the path from the 
        // output of showSaveFilePicker
        var pom = document.createElement('a');
        pom.href = url;

        pom.setAttribute('download', handle.name); // "rectangleExport.csv");
        pom.click();
      }
    }
  }
  else
    alert("Please define an area rectangle before attempting to export");
}

function HeightStatisticsInEllipse(ellipseEdgeRange)
{
  var minHeight = Number.MAX_VALUE;
  var aveHeight = 0.0;
  var maxEdgeHeight = Number.MIN_VALUE;
  var minEdgeHeight = Number.MAX_VALUE;
  var aveEdgeHeight = 0.0;

  var lonMin = Math.min(Math.min(Math.min(areaRectVertices[0], areaRectVertices[3]), areaRectVertices[6]), areaRectVertices[9]);
  var lonMax = Math.max(Math.max(Math.max(areaRectVertices[0], areaRectVertices[3]), areaRectVertices[6]), areaRectVertices[9]);

  var latMin = Math.min(Math.min(Math.min(areaRectVertices[1], areaRectVertices[4]), areaRectVertices[7]), areaRectVertices[10]);
  var latMax = Math.max(Math.max(Math.max(areaRectVertices[1], areaRectVertices[4]), areaRectVertices[7]), areaRectVertices[10]);

  var axisLon = (lonMax - lonMin) / 2.0;
  var axisLat = (latMax - latMin) / 2.0;
  var majorAxis = Math.max(axisLon, axisLat);
  var minorAxis = Math.min(axisLon, axisLat);
  var focusDist = Math.sqrt(majorAxis*majorAxis - minorAxis*minorAxis);
  var borderDist = 2.0 * majorAxis; // Points are on the ellipse if the sum of the distances to the two foci 
                                    // is equal to twice the major axis
  var focus0Lat, focus0Lon, focus1Lat, focus1Lon;
  var cLon = (lonMin + lonMax) / 2.0;
  var cLat = (latMin + latMax) / 2.0;
  
  if (majorAxis == axisLon)
  {
    focus0Lon = cLon - focusDist;
    focus0Lat = cLat;
    focus1Lon = cLon + focusDist;
    focus1Lat = cLat;
  }
  else
  {
    focus0Lon = cLon;
    focus0Lat = cLat - focusDist;
    focus1Lon = cLon;
    focus1Lat = cLat + focusDist;
  }

  for (let i = 0; i < tileArray.length; i++)
  {
    var tile = tileArray[i];
    if ((tile.longitude_min < lonMax) && (tile.longitude_max > lonMin) && (tile.latitude_min < latMax) && (tile.latitude_max > latMin))
    {
      var lonStart = Math.max(tile.longitude_min, lonMin);
      var lonEnd = Math.min(tile.longitude_max, lonMax);
      var latStart = Math.max(tile.latitude_min, latMin);
      var latEnd = Math.min(tile.latitude_max, latMax);

      var deltaLon = (tile.longitude_max - tile.longitude_min) / tile.columns;
      var deltaLat = (tile.latitude_max - tile.latitude_min) / tile.rows;
      var lonStartIndex = Math.ceil((lonStart - tile.longitude_min) / deltaLon);
      var latStartIndex = Math.ceil((latStart - tile.latitude_min) / deltaLat);
      var lonEndIndex = Math.floor((lonEnd - tile.longitude_min) / deltaLon);
      var latEndIndex = Math.floor((latEnd - tile.latitude_min) / deltaLat);

      var insideSampleCount = 0;
      var borderSampleCount = 0;
      for (var latID = latStartIndex; latID <= latEndIndex; latID++)
      {
        for (let lonID = lonStartIndex; lonID <= lonEndIndex; lonID++)
        {
          let curLon = tile.longitude_min + lonID * deltaLon;
          let curLat = tile.latitude_min + latID * deltaLat;
          let focus0Dist = Math.sqrt((curLon - focus0Lon)**2 + (curLat - focus0Lat)**2);
          let focus1Dist = Math.sqrt((curLon - focus1Lon)**2 + (curLat - focus1Lat)**2);
          
          if (focus0Dist + focus1Dist < borderDist) // point is inside ellipse
          {
            insideSampleCount++;
            let curHeight = tile.image_data[tile.columns * (tile.rows - latID) + lonID];
            minHeight = Math.min(minHeight, curHeight);
            aveHeight += curHeight;
  
          }
          if (Math.abs(focus0Dist + focus1Dist - borderDist) < ellipseEdgeRange)  // point is "near" ellipse border
          {
            borderSampleCount++;
            let curHeight = tile.image_data[tile.columns * (tile.rows - latID) + lonID];

            maxEdgeHeight = Math.max(maxEdgeHeight, curHeight);
            minEdgeHeight = Math.min(minEdgeHeight, curHeight);
            aveEdgeHeight += curHeight;
          }
        }
      }
      aveHeight /= insideSampleCount;
      aveEdgeHeight /= borderSampleCount;

      return {"minHeight": minHeight, 
              "aveHeight": aveHeight,
              "minEdgeHeight": minEdgeHeight,
              "maxEdgeHeight": maxEdgeHeight,
              "aveEdgeHeight": aveEdgeHeight};
    }
  }
}

function getHeightFromTileArray(lat, lon)
{
  var curElev = -99999999;
  for (let i = 0; i < tileArray.length; i++)
  {
    let tmpTile = tileArray[i];
    if ((tmpTile.longitude_min <= lon && lon < tmpTile.longitude_max) && 
        (tmpTile.latitude_min <= lat && lat < tmpTile.latitude_max))
    {
      var deltaLon = (tmpTile.longitude_max - tmpTile.longitude_min) / tmpTile.columns;
      var deltaLat = (tmpTile.latitude_max - tmpTile.latitude_min) / tmpTile.rows;
      var latID = Math.floor((lat - tmpTile.latitude_min) / deltaLat);
      var lonID = Math.floor((lon - tmpTile.longitude_min) / deltaLon);
      curElev = tmpTile.image_data[tmpTile.columns * (tmpTile.rows - latID) + lonID] / 2;    // z
    }
  }
  return curElev;
}

/**
 * Render the high Resolution texture (8k x 8k == 512pix/degree)
 */
function drawScene_hiRes() {
  if (rendering3D)
  {
    drawScene_threeD();
    return;
  }

  gl_hiRes.useProgram(gpuProgram_hiRes);
  gl_hiRes.viewport(
    0,
    0,
    gl_hiRes.canvas.clientWidth,
    gl_hiRes.canvas.clientHeight
  );
  gl_hiRes.clear(gl_hiRes.COLOR_BUFFER_BIT | gl_hiRes.DEPTH_BUFFER_BIT);
  let aspect = gl_hiRes.canvas.width / gl_hiRes.canvas.height;

  // used standard orth projection [-1, +1] adjusted for the canvas aspect ratio and then
  // translated to look at the target point on the map
  var pMatrix = mat4.create();
  mat4.ortho(
    viewCenter_hiRes[0] - aspect * viewSize_hiRes, // left
    viewCenter_hiRes[0] + aspect * viewSize_hiRes, // right
    viewCenter_hiRes[1] - 1.0 * viewSize_hiRes, // bottom
    viewCenter_hiRes[1] + 1.0 * viewSize_hiRes, // top
    -1.0,
    1.0,
    pMatrix
  );

  var mvMatrix = mat4.create();
  mat4.identity(mvMatrix);

  gl_hiRes.uniformMatrix4fv(gpuProgram_hiRes.uMVMatrix, false, mvMatrix);
  gl_hiRes.uniformMatrix4fv(gpuProgram_hiRes.uPMatrix, false, pMatrix);

  // Need to re-do this because we will be using the same program for the high-resolution panels
  // and the low-resolution preview. 
  initUniforms_hiRes(gpuProgram_hiRes);

  ///////////////////////////////////////////////////////////////////////////////////////////////////
  // Now draw the tiles.  We loop through the tile array and draw each tile's geometry with
  // its appropriate texture
  ///////////////////////////////////////////////////////////////////////////////////////////////////
  for (var i = 0; i < tileArray.length; i++) {
    var tile = tileArray[i];

    // Set up the vertex buffer and connect it to the vertexPosition attribute in GLSL
    gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, tile.vertex_buffer); // where to get data for drawing
    gl_hiRes.vertexAttribPointer(
      gpuProgram_hiRes.aVertexPosition,
      3,
      gl_hiRes.FLOAT,
      false,
      0,
      0
    );
    gl_hiRes.enableVertexAttribArray(gpuProgram_hiRes.aVertexPosition); // we use vertexPosition in Code == aVertexPosition in GLSL

    // Bind the tile's height texture
    gl_hiRes.activeTexture(gl_hiRes.TEXTURE0);
    gl_hiRes.bindTexture(gl_hiRes.TEXTURE_2D, tile.tex_object);
    gl_hiRes.uniform1i(gpuProgram_hiRes.uSampler, 0);

    // Enable anisotropic filtering if available
    if (anisotropy) {
      var max = gl_hiRes.getParameter(
        anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT
      );
      gl_hiRes.texParameterf(
        gl_hiRes.TEXTURE_2D,
        anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
        max
      );
    }

    // Attach the vertex texture coordinates
    gl_hiRes.enableVertexAttribArray(gpuProgram_hiRes.aVertexTextureCoords);
    gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, tile.tex_coord_buffer);
    gl_hiRes.vertexAttribPointer(
      gpuProgram_hiRes.aVertexTextureCoords,
      2,
      gl_hiRes.FLOAT,
      false,
      0,
      0
    );

    // Bind the color map
    gl_hiRes.activeTexture(gl_hiRes.TEXTURE1);
    gl_hiRes.bindTexture(gl_hiRes.TEXTURE_2D, colorTex_hiRes);
    gl_hiRes.uniform1i(gpuProgram_hiRes.uColorSampler, 1);
    gl_hiRes.uniform1f(gpuProgram_hiRes.texScale, texScale_hiRes);

    // now index buffer object & draw
    gl_hiRes.bindBuffer(gl_hiRes.ELEMENT_ARRAY_BUFFER, tile.index_buffer); // bind index buffer for drawing
    gl_hiRes.drawElements(gl_hiRes.TRIANGLES, 6, gl_hiRes.UNSIGNED_SHORT, 0);
  }

  if (previewTexObj != null)
  {
    initUniforms_lowResPreview(gpuProgram_hiRes);

    // Now draw the low resolution preview at a negative depth so that it will sit behind any high resolution tiles that
    // are rendered
    gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, previewVertBuffer); // where to get data for drawing
    gl_hiRes.vertexAttribPointer(
      gpuProgram_hiRes.aVertexPosition,
      3,
      gl_hiRes.FLOAT,
      false,
      0,
      0
    );
    gl_hiRes.enableVertexAttribArray(gpuProgram_hiRes.aVertexPosition); // we use vertexPosition in Code == aVertexPosition in GLSL

    gl_hiRes.activeTexture(gl_hiRes.TEXTURE0);
    gl_hiRes.bindTexture(gl_hiRes.TEXTURE_2D, previewTexObj);
    gl_hiRes.uniform1i(gpuProgram_hiRes.uSampler, 0);

    // Enable anisotropic filtering if available
    if (anisotropy) {
      var max = gl_hiRes.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl_hiRes.texParameterf(gl_hiRes.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, max);
    }

    // Attach the vertex texture coordinates
    gl_hiRes.enableVertexAttribArray(gpuProgram_hiRes.aVertexTextureCoords);
    gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, previewTexCoordBuffer);
    gl_hiRes.vertexAttribPointer(
      gpuProgram_hiRes.aVertexTextureCoords,
      2,
      gl_hiRes.FLOAT,
      false,
      0,
      0
    );

    // Bind the color map
    gl_hiRes.activeTexture(gl_hiRes.TEXTURE1);
    gl_hiRes.bindTexture(gl_hiRes.TEXTURE_2D, colorTex_hiRes);
    gl_hiRes.uniform1i(gpuProgram_hiRes.uColorSampler, 1);

    // now index buffer object & draw
    gl_hiRes.drawArrays(gl_hiRes.TRIANGLES, 0, 6);
  }

  /////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Now, draw the path for the profile as a line strip.  It has no texture but has a color set by the
  // uniform parameter to its shader called "LineColor". Note that we don't use an index buffer for this
  // since the vertices are not shared and can be immediately drawn from the vertex buffer.
  /////////////////////////////////////////////////////////////////////////////////////////////////////////////
  gl_hiRes.useProgram(pathProgram_hiRes);
  var vertexPosition = gl_hiRes.getAttribLocation(
    pathProgram_hiRes,
    "aVertexPosition"
  );
  var uPMatrix = gl_hiRes.getUniformLocation(pathProgram_hiRes, "uPMatrix");
  var uMVMatrix = gl_hiRes.getUniformLocation(pathProgram_hiRes, "uMVMatrix");
  var uLineColor = gl_hiRes.getUniformLocation(pathProgram_hiRes, "lineColor");

  gl_hiRes.uniformMatrix4fv(uMVMatrix, false, mvMatrix);
  gl_hiRes.uniformMatrix4fv(uPMatrix, false, pMatrix);
  gl_hiRes.uniform3f(uLineColor, 1.0, 1.0, 0.0);

  gl_hiRes.enableVertexAttribArray(vertexPosition);
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, pathVertBuffer);
  gl_hiRes.bufferData(
    gl_hiRes.ARRAY_BUFFER,
    new Float32Array(pathVerts),
    gl_hiRes.STATIC_DRAW
  ); //bind data to VBO
  gl_hiRes.vertexAttribPointer(vertexPosition, 3, gl_hiRes.FLOAT, false, 0, 0);

  // now index buffer object & draw
  gl_hiRes.drawArrays(gl_hiRes.LINE_STRIP, 0, pathVerts.length / 3);

  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Next, draw a circle around the point tracking the cursor on the height profile.  This point's 
  // Lat & Lon are stored in profileSlopePoints[2] for now.  
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////

  if (profileSlopePoints[2].x != -1000.0)
  {
    console.log("Drawing Circle");
    var circleVerts = [];
    var radius = viewSize_hiRes / 50.0;  // Make the size of the circle a 
    for (let i = 0; i <= 20; i++)
    {
      let angle = 2.0 * Math.PI * i / 20.0;
      circleVerts.push(curSlopeCursor[0] + radius * Math.cos(angle), curSlopeCursor[1] + radius * Math.sin(angle), 0.2);
    }
    gl_hiRes.uniform3f(uLineColor, 1.0, 0.5, 0.0);

    gl_hiRes.enableVertexAttribArray(vertexPosition);
    gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, pathVertBuffer);
    gl_hiRes.bufferData(
      gl_hiRes.ARRAY_BUFFER,
      new Float32Array(circleVerts),
      gl_hiRes.STATIC_DRAW
    ); //bind data to VBO
    gl_hiRes.vertexAttribPointer(vertexPosition, 3, gl_hiRes.FLOAT, false, 0, 0);

    // now index buffer object & draw
    gl_hiRes.drawArrays(gl_hiRes.TRIANGLE_FAN, 0, circleVerts.length / 3);
  }

  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  // Next, draw the ellipse.
  ///////////////////////////////////////////////////////////////////////////////////////////////////////////////
  gl_hiRes.uniform3f(uLineColor, 0.0, 0.0, 0.0);

  if (areaRectDefined) {
    gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, pathVertBuffer);
    gl_hiRes.bufferData(
      gl_hiRes.ARRAY_BUFFER,
      new Float32Array(areaRectVertices),
      gl_hiRes.STATIC_DRAW
    ); //bind data to VBO
    gl_hiRes.vertexAttribPointer(
      vertexPosition,
      3,
      gl_hiRes.FLOAT,
      false,
      0,
      0
    );
    // now index buffer object & draw
    gl_hiRes.drawArrays(gl_hiRes.LINE_STRIP, 0, areaRectVertices.length / 3);
    if (areaEllipseVertices.length > 0) {
      gl_hiRes.uniform3f(uLineColor, 0.0, 0.0, 1.0);
      gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, pathVertBuffer);
      gl_hiRes.bufferData(
        gl_hiRes.ARRAY_BUFFER,
        new Float32Array(areaEllipseVertices),
        gl_hiRes.STATIC_DRAW
      ); //bind data to VBO
      gl_hiRes.vertexAttribPointer(
        vertexPosition,
        3,
        gl_hiRes.FLOAT,
        false,
        0,
        0
      );
      // now index buffer object & draw
      gl_hiRes.drawArrays(gl_hiRes.LINE_STRIP, 0, areaEllipseVertices.length / 3);
    }
  }
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, null);
  
  // Next, draw the text banners for the latitude and longitude ranges of the current view
  // First, we need to write the text to the html canvas and then blit the canvas to the texture memory
  var minLon = viewCenter_hiRes[0] - viewSize_hiRes * 2;  // Width of view is 4*viewSize
  var minLat = viewCenter_hiRes[1] - viewSize_hiRes;      // Height of view is 2*viewSize
  var maxLon = viewCenter_hiRes[0] + viewSize_hiRes * 2;
  var maxLat = viewCenter_hiRes[1] + viewSize_hiRes;

  var textCanvas = document.getElementById('coordMinTexture');
  var ctx = textCanvas.getContext('2d');
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "24px Arial";

  gl_hiRes.useProgram(bannerProgram_hiRes);
  var uPMatrix = gl_hiRes.getUniformLocation(bannerProgram_hiRes, "uPMatrix");
  var uMVMatrix = gl_hiRes.getUniformLocation(bannerProgram_hiRes, "uMVMatrix");

  gl_hiRes.uniformMatrix4fv(uMVMatrix, false, mvMatrix);
  gl_hiRes.uniformMatrix4fv(uPMatrix, false, pMatrix);

  // Bind the text banner's texture object and draw the rectangle using the bannerProgram
  gl_hiRes.activeTexture(gl_hiRes.TEXTURE0);
  // gl_hiRes.uniform1i(gl_hiRes.getUniformLocation(bannerProgram_hiRes, "textMap"), 0);  // Maps in glsl default to 0
  gl_hiRes.pixelStorei(gl_hiRes.UNPACK_FLIP_Y_WEBGL, true);
  gl_hiRes.bindTexture(gl_hiRes.TEXTURE_2D, bannerTextureObj);
  gl_hiRes.texImage2D(gl_hiRes.TEXTURE_2D, 0, gl_hiRes.RGBA, gl_hiRes.RGBA, gl_hiRes.UNSIGNED_BYTE, textCanvas);
  gl_hiRes.generateMipmap(gl_hiRes.TEXTURE_2D);

  // Enable anisotropic filtering if available
  if (anisotropy) {
    var max = gl_hiRes.getParameter(
      anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT
    );
    gl_hiRes.texParameterf(
      gl_hiRes.TEXTURE_2D,
      anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
      max
    );
  }
    
  // Attach the vertex texture coordinates
  var bannerW = textCanvas.width / canvas_hiRes.width * viewSize_hiRes * 2;  // view width is 4*viewSize
  var bannerH = textCanvas.height / canvas_hiRes.height * viewSize_hiRes; // view height is 2*viewSize
  bannerVerts = [minLon, minLat, .5, 
                 minLon + bannerW, minLat, .5,
                 minLon + bannerW, minLat + bannerH, .5,
                 minLon + bannerW, minLat + bannerH, .5, 
                 minLon, minLat + bannerH, .5, 
                 minLon, minLat, .5, 
  ];
  bannerTexCoord = [0, 0, 
               1, 0,
               1, 1,
               1, 1,
               0, 1,
               0, 0];

  var vertexPosition = gl_hiRes.getAttribLocation(bannerProgram_hiRes, "aVertexPosition");
  gl_hiRes.enableVertexAttribArray(vertexPosition);
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, bannerVertexBuffer);
  gl_hiRes.bufferData(gl_hiRes.ARRAY_BUFFER, new Float32Array(bannerVerts), 
                      gl_hiRes.STATIC_DRAW);
  gl_hiRes.vertexAttribPointer(vertexPosition, 3, gl_hiRes.FLOAT,
                               false, 0, 0);
  
  var vertexTex = gl_hiRes.getAttribLocation(bannerProgram_hiRes, "aVertexUV");
  gl_hiRes.enableVertexAttribArray(vertexTex);
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, bannerTexBuffer);
  gl_hiRes.bufferData(gl_hiRes.ARRAY_BUFFER, new Float32Array(bannerTexCoord), 
                      gl_hiRes.STATIC_DRAW);
  gl_hiRes.vertexAttribPointer(vertexTex, 2, gl_hiRes.FLOAT,
                               false, 0, 0);
  gl_hiRes.drawArrays(gl_hiRes.TRIANGLES, 0, 6);

  var textMin = "Lat: " + minLat.toFixed(2) + ", Lon: " + minLon.toFixed(2);
  ctx.clearRect(0, 0, textCanvas.width, textCanvas.height);
  ctx.fillText(textMin, textCanvas.width / 2, textCanvas.height / 2);

  textCanvas = document.getElementById('coordMaxTexture');
  ctx = textCanvas.getContext('2d');
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "24px Arial";

  var textMax = "Lat: " + maxLat.toFixed(2) + ", Lon: " + maxLon.toFixed(2);
  ctx.clearRect(0, 0, textCanvas.width, textCanvas.height);
  ctx.fillText(textMax, textCanvas.width / 2, textCanvas.height / 2);

  gl_hiRes.texImage2D(gl_hiRes.TEXTURE_2D, 0, gl_hiRes.RGBA, gl_hiRes.RGBA, gl_hiRes.UNSIGNED_BYTE, textCanvas);
  gl_hiRes.generateMipmap(gl_hiRes.TEXTURE_2D);

  bannerVerts = [maxLon - bannerW, maxLat - bannerH, .5, 
                maxLon, maxLat - bannerH, .5,
                maxLon, maxLat, .5,
                maxLon, maxLat, .5, 
                maxLon - bannerW, maxLat, .5, 
                maxLon - bannerW, maxLat - bannerH, .5, 
  ]
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, bannerVertexBuffer);
  gl_hiRes.bufferData(gl_hiRes.ARRAY_BUFFER, new Float32Array(bannerVerts), 
                      gl_hiRes.STATIC_DRAW);
  gl_hiRes.drawArrays(gl_hiRes.TRIANGLES, 0, 6);

  // Finally, draw the banner for the cursor, but only if the ctrl-key is being held down.
  if (bannerShowCursorLoc && curMode == navMode)
  {
    // Need to track current mouse position on the canvas in mouse move ... even if the button is not pressed :)
    textCanvas = document.getElementById('coordCursor');
    ctx = textCanvas.getContext('2d');
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "24px Arial";

    // var curElev = -99999999;
    // for (let i = 0; i < tileArray.length; i++)
    // {
    //   let tmpTile = tileArray[i];
    //   if ((tmpTile.longitude_min <= bannerCurLon && bannerCurLon < tmpTile.longitude_max) && 
    //       (tmpTile.latitude_min <= bannerCurLat && bannerCurLat < tmpTile.latitude_max))
    //   {
    //     var deltaLon = (tile.longitude_max - tile.longitude_min) / tile.columns;
    //     var deltaLat = (tile.latitude_max - tile.latitude_min) / tile.rows;
    //     var latID = Math.floor((bannerCurLat - tmpTile.latitude_min) / deltaLat);
    //     var lonID = Math.floor((bannerCurLon - tmpTile.longitude_min) / deltaLon);
    //     curElev = tmpTile.image_data[tile.columns * (tile.rows - latID) + lonID] / 2;    // z
    //   }
    // }
    var curElev = getHeightFromTileArray(bannerCurLat, bannerCurLon);
    
    if (curElev > -999999)
    {
      var textMax = "Lat: " + bannerCurLat.toFixed(2) + ", Lon: " + bannerCurLon.toFixed(2) + ", Elev: " + curElev.toFixed(2);
      ctx.clearRect(0, 0, textCanvas.width, textCanvas.height);
      ctx.fillText(textMax, textCanvas.width / 2, textCanvas.height / 2);
    
      gl_hiRes.texImage2D(gl_hiRes.TEXTURE_2D, 0, gl_hiRes.RGBA, gl_hiRes.RGBA, gl_hiRes.UNSIGNED_BYTE, textCanvas);
      gl_hiRes.generateMipmap(gl_hiRes.TEXTURE_2D);
    
      bannerW = textCanvas.width / canvas_hiRes.width * viewSize_hiRes * 2;  // view width is 4*viewSize
      bannerH = textCanvas.height / canvas_hiRes.height * viewSize_hiRes; // view height is 2*viewSize  
      bannerVerts = [bannerCurLon, bannerCurLat, .5, 
                    bannerCurLon + bannerW, bannerCurLat, .5,
                    bannerCurLon + bannerW, bannerCurLat + bannerH, .5,
                    bannerCurLon + bannerW, bannerCurLat + bannerH, .5, 
                    bannerCurLon, bannerCurLat + bannerH, .5, 
                    bannerCurLon, bannerCurLat, .5]
      gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, bannerVertexBuffer);
      gl_hiRes.bufferData(gl_hiRes.ARRAY_BUFFER, new Float32Array(bannerVerts), 
                          gl_hiRes.STATIC_DRAW);
      gl_hiRes.drawArrays(gl_hiRes.TRIANGLES, 0, 6);
    }
  }
  gl_hiRes.bindTexture(gl_hiRes.TEXTURE_2D, null);
}

function drawScene_threeD() {
  gl_hiRes.useProgram(gpuProgram_hiRes);
  gl_hiRes.viewport(
    0,
    0,
    gl_hiRes.canvas.clientWidth,
    gl_hiRes.canvas.clientHeight
  );
  gl_hiRes.clear(gl_hiRes.COLOR_BUFFER_BIT | gl_hiRes.DEPTH_BUFFER_BIT);
  let aspect = gl_hiRes.canvas.width / gl_hiRes.canvas.height;

  // used standard orth projection [-1, +1] adjusted for the canvas aspect ratio and then
  // translated to look at the target point on the map
  var pMatrix = mat4.create();
  mat4.perspective(threeD_fov, 2, 2, 1000, pMatrix);

  var lonMin, lonMax, latMin, latMax;

  lonMin = lonMax = areaRectVertices[0]; // Remember, x = longitude
  latMin = latMax = areaRectVertices[1];

  lonMin = Math.min(lonMin, Math.min(Math.min(areaRectVertices[3], areaRectVertices[6]), areaRectVertices[9])); // Assume that the last vertex equals the first
  latMin = Math.min(latMin, Math.min(Math.min(areaRectVertices[4], areaRectVertices[7]), areaRectVertices[10])); // Assume that the last vertex equals the first
  lonMax = Math.max(lonMin, Math.max(Math.max(areaRectVertices[3], areaRectVertices[6]), areaRectVertices[9])); // Assume that the last vertex equals the first
  latMax = Math.max(latMin, Math.max(Math.max(areaRectVertices[4], areaRectVertices[7]), areaRectVertices[10])); // Assume that the last vertex equals the first

  var size = Math.max(Math.sqrt((lonMax - lonMin)**2 + (latMax - latMin)**2) * Math.sin(30 * Math.PI / 180.0), 10.0);
  var altRad = threeD_altitude * Math.PI / 180.0;
  var azRad = threeD_azimuth * Math.PI / 180.0;
  var eye = [(lonMin + lonMax) / 2.0 + size * Math.cos(azRad) * Math.cos(altRad), 
             (latMin + latMax) / 2.0 + size * Math.sin(azRad) * Math.cos(altRad), 
             size * Math.sin(altRad)];
  var target = [(lonMin + lonMax) / 2.0, (latMin + latMax) / 2.0, 0.0];
  var up = [0, 0, 1];
  var mvMatrix = mat4.create();
  mat4.lookAt(eye, target, up, mvMatrix);

  gl_hiRes.uniformMatrix4fv(gpuProgram_hiRes.uMVMatrix, false, mvMatrix);
  gl_hiRes.uniformMatrix4fv(gpuProgram_hiRes.uPMatrix, false, pMatrix);

  // Need to re-do this because we will be using the same program for the high-resolution panels
  // and the low-resolution preview. 
  initUniforms_hiRes(gpuProgram_hiRes);
  gl_hiRes.uniform1f(gpuProgram_hiRes.aHeightScale, 1.0);  // Turn on relief mapping
  gl_hiRes.uniform2f(
    gpuProgram_hiRes.aLongLatRange,
    (lonMax - lonMin) / 2,
    (latMax - latMin) / 2
  ); // 218.5 - 202.5, -33.75 - -45.0); // lonMax - lonMin, latMax - latMin


  ///////////////////////////////////////////////////////////////////////////////////////////////////
  // Now draw the tiles.  We loop through the tile array and draw each tile's geometry with
  // its appropriate texture
  ///////////////////////////////////////////////////////////////////////////////////////////////////
  for (var i = 0; i < tileArray.length; i++) {
    var tile = tileArray[i];

    if (tile.threeD_vertices != null)
    {
      // Set up the vertex buffer and connect it to the vertexPosition attribute in GLSL
      gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, tile.threeD_vertices); // where to get data for drawing
      gl_hiRes.vertexAttribPointer(
        gpuProgram_hiRes.aVertexPosition,
        3,
        gl_hiRes.FLOAT,
        false,
        0,
        0
      );
      gl_hiRes.enableVertexAttribArray(gpuProgram_hiRes.aVertexPosition); // we use vertexPosition in Code == aVertexPosition in GLSL

      // Bind the tile's height texture
      gl_hiRes.activeTexture(gl_hiRes.TEXTURE0);
      gl_hiRes.bindTexture(gl_hiRes.TEXTURE_2D, tile.tex_object);
      gl_hiRes.uniform1i(gpuProgram_hiRes.uSampler, 0);

      // Enable anisotropic filtering if available
      if (anisotropy) {
        var max = gl_hiRes.getParameter(
          anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT
        );
        gl_hiRes.texParameterf(
          gl_hiRes.TEXTURE_2D,
          anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
          max
        );
      }

      // Attach the vertex texture coordinates
      gl_hiRes.enableVertexAttribArray(gpuProgram_hiRes.aVertexTextureCoords);
      gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, tile.threeD_texCoord);
      gl_hiRes.vertexAttribPointer(
        gpuProgram_hiRes.aVertexTextureCoords,
        2,
        gl_hiRes.FLOAT,
        false,
        0,
        0
      );

      // Bind the color map
      gl_hiRes.activeTexture(gl_hiRes.TEXTURE1);
      gl_hiRes.bindTexture(gl_hiRes.TEXTURE_2D, colorTex_hiRes);
      gl_hiRes.uniform1i(gpuProgram_hiRes.uColorSampler, 1);
      gl_hiRes.uniform1f(gpuProgram_hiRes.texScale, texScale_hiRes);

      // now index buffer object & draw
      gl_hiRes.bindBuffer(gl_hiRes.ELEMENT_ARRAY_BUFFER, tile.threeD_indices); // bind index buffer for drawing
      gl_hiRes.drawElements(gl_hiRes.TRIANGLES, (tile.segLonRes - 1) * (tile.segLatRes - 1) * 6, gl_hiRes.UNSIGNED_INT, 0);
      // gl_hiRes.drawElements(gl_hiRes.TRIANGLES, 100, gl_hiRes.UNSIGNED_INT, 0);
    }
  }
}

/*
 * Render the LOLA Navigation Map (2k x 1k == 4pix/degree)
 */
function drawScene_nav(gl) {
  gl.useProgram(gpuProgram_nav);
  gl.viewport(0, 0, gl.canvas.clientWidth, gl.canvas.clientHeight);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); // clears the screen with clear color

  let aspect = gl_nav.canvas.width / gl_nav.canvas.height;

  // We may want this to change later if we allow shifting of the navigation window to show the front of the planetary
  // body to the viewer (i.e. the area around longitude = 0, which is now divided on the opposite edges of the map)
  var pMatrix = mat4.create();
  mat4.ortho(
    viewCenter_nav[0] - aspect * viewSize_nav, // left
    viewCenter_nav[0] + aspect * viewSize_nav, // right
    viewCenter_nav[1] - 1.0 * viewSize_nav, // bottom
    viewCenter_nav[1] + 1.0 * viewSize_nav, // top
    -1.0,
    1.0,
    pMatrix
  );
  mat4.identity(mvMatrix);

  ////////////////////////////////////////////////////////////////////////////////////
  // First, we draw the rectangle for the navigation panel, with the height texture
  ////////////////////////////////////////////////////////////////////////////////////
  var mvMatrix = mat4.identity();
  initUniforms_nav(gpuProgram_nav);
  gl.uniformMatrix4fv(gpuProgram_nav.uMVMatrix, false, mvMatrix);
  gl.uniformMatrix4fv(gpuProgram_nav.uPMatrix, false, pMatrix);

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer_nav); // where to get data for drawing
  gl.vertexAttribPointer(
    gpuProgram_nav.aVertexPosition,
    3,
    gl.FLOAT,
    false,
    0,
    0
  ); // use the aVertexPosition as input uniform
  gl.enableVertexAttribArray(gpuProgram_nav.aVertexPosition); // we use vertexPosition in Code == aVertexPosition in GLSL

  //Texture mapping
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, heightTex_nav);
  gl.uniform1i(gpuProgram_nav.uSampler, 0);

  gl.enableVertexAttribArray(gpuProgram_nav.aVertexTextureCoords);
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer_nav);
  gl.vertexAttribPointer(
    gpuProgram_nav.aVertexTextureCoords,
    2,
    gl.FLOAT,
    false,
    0,
    0
  );

  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, colorTex_nav);
  gl.uniform1i(gpuProgram_nav.uColorSampler, 1);

  // add scale for integers image files
  gl.uniform1f(gpuProgram_nav.texScale, texScale_nav);

  // now indice buffer object
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer_nav); // bind index buffer for drawing

  // new draw using the above buffers and attributes.  It might be nice to eliminate the index buffer
  // here to simplify the data.  The vertices are not shared and so, it is possible to do so.
  gl.drawElements(gl.TRIANGLES, indices_nav.length, gl.UNSIGNED_SHORT, 0);

  //////////////////////////////////////////////////////////////////////////////////////////////////
  // Now, draw the grid lines for the quarter-tiles.  Note that this uses the previously defined
  // vertex buffer for the lines, so if we change to MARS or som other planteary body, this doesn't
  // have to change.  Only the code that sets up the vertex buffer.
  //////////////////////////////////////////////////////////////////////////////////////////////////
  gl.useProgram(gridProgram_nav);
  var vertexPosition = gl.getAttribLocation(gridProgram_nav, "aVertexPosition");
  var uPMatrix = gl.getUniformLocation(gridProgram_nav, "uPMatrix");
  var uMVMatrix = gl.getUniformLocation(gridProgram_nav, "uMVMatrix");
  var uLineColor = gl.getUniformLocation(gridProgram_nav, "lineColor");

  gl.uniformMatrix4fv(uMVMatrix, false, mvMatrix);
  gl.uniformMatrix4fv(uPMatrix, false, pMatrix);
  gl.uniform3f(uLineColor, 0.0, 0.0, 0.0);

  gl.enableVertexAttribArray(vertexPosition);
  gl.bindBuffer(gl.ARRAY_BUFFER, gridVertBuffer_nav);
  gl.vertexAttribPointer(vertexPosition, 3, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.LINES, 0, gridIndexLength);

  //////////////////////////////////////////////////////////////////////////////////
  // And draw the currently selected quarter-tile
  //////////////////////////////////////////////////////////////////////////////////
  var curPanelOrigin = panelCoords(curPanel, DpanelHeightLat(), DpanelWidthLon() );
  var curPanelMinLon = curPanelOrigin[1]; // hiRes window is twice as wide as high
  var curPanelMaxLon = curPanelOrigin[1] + DpanelWidthLon() ;
  var curPanelMinLat = curPanelOrigin[0];
  var curPanelMaxLat = curPanelOrigin[0] + DpanelHeightLat();
  var curPanelVerts = [
    curPanelMinLon,
    curPanelMinLat,
    0.2,
    curPanelMaxLon,
    curPanelMinLat,
    0.2,
    curPanelMaxLon,
    curPanelMaxLat,
    0.2,
    curPanelMinLon,
    curPanelMaxLat,
    0.2,
    curPanelMinLon,
    curPanelMinLat,
    0.2,
  ];

  gl.uniform3f(uLineColor, 1.0, 1.0, 1.0);
  gl.enableVertexAttribArray(vertexPosition);
  gl.bindBuffer(gl.ARRAY_BUFFER, curPanelVertBuffer_nav);
  gl.bufferData(
    gl_nav.ARRAY_BUFFER,
    new Float32Array(curPanelVerts),
    gl_nav.STATIC_DRAW
  );

  gl.vertexAttribPointer(vertexPosition, 3, gl.FLOAT, false, 0, 0);

  // now index buffer object
  gl.drawArrays(gl.LINE_STRIP, 0, 5);

  //////////////////////////////////////////////////////////////////////////////////////////////////
  // Finally, draw a rectangle around the current view.  This is being updated often, so we build
  // the vertex buffer right here.  Note that we use drawArrays instead of index buffers to simplify
  // this and eliminate a global variable for the index buffer.
  //////////////////////////////////////////////////////////////////////////////////////////////////
  var curViewMinLon = viewCenter_hiRes[0] - viewSize_hiRes * 2; // hiRes window is twice as wide as high
  var curViewMaxLon = viewCenter_hiRes[0] + viewSize_hiRes * 2;
  var curViewMinLat = viewCenter_hiRes[1] - viewSize_hiRes;
  var curViewMaxLat = viewCenter_hiRes[1] + viewSize_hiRes;
  var curViewVerts = [
    curViewMinLon,
    curViewMinLat,
    0.3,
    curViewMaxLon,
    curViewMinLat,
    0.3,
    curViewMaxLon,
    curViewMaxLat,
    0.3,
    curViewMinLon,
    curViewMaxLat,
    0.3,
    curViewMinLon,
    curViewMinLat,
    0.3,
  ];

  gl.uniform3f(uLineColor, 1.0, 1.0, 0.0);
  gl.enableVertexAttribArray(vertexPosition);
  gl.bindBuffer(gl.ARRAY_BUFFER, curViewVertBuffer_nav);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array(curViewVerts),
    gl.STATIC_DRAW
  );
  gl.vertexAttribPointer(vertexPosition, 3, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.LINE_STRIP, 0, 5);
}


// These need to use the data defined above!
function initUniforms_nav(gpuProgram) {
  gl_nav.uniform2f(gpuProgram.aLongLatRange, 359.5 - 0.5, 89.5 - -89.5); // lonMax - lonMin, latMax - latMin
  gl_nav.uniform2f(gpuProgram.aHeightRange, curBodyData.elevationMin, curBodyData.elevationMax);  // Why are the units of the nav map different?
  gl_nav.uniform1f(gpuProgram.aReliefScale, curBodyData.navReliefScale);
  gl_nav.uniform1f(gpuProgram.aHeightScale, 0.0);
  gl_nav.uniform3fv(gpuProgram.aLightDir, LightDir);
  gl_nav.uniform3fv(gpuProgram.aMonochromeColor, curBodyData.monochromeColor);
  gl_nav.uniform1f(gpuProgram.aUseMono, curBodyData.useMono);
  gl_nav.uniform1f(gpuProgram.aMPerDegAtEq, curBodyData.eqMetersPerDegree);
}

// 512
function initUniforms_hiRes(gpuProgram) {
  gl_hiRes.uniform2f(
    gpuProgram.aLongLatRange,
    viewSize_hiRes * 2,
    viewSize_hiRes
  ); // 218.5 - 202.5, -33.75 - -45.0); // lonMax - lonMin, latMax - latMin
  gl_hiRes.uniform2f(gpuProgram.aHeightRange, curBodyData.elevationMin, curBodyData.elevationMax);
  gl_hiRes.uniform1f(gpuProgram.aReliefScale, curBodyData.hiresReliefScale);
  gl_hiRes.uniform1f(gpuProgram.aHeightScale, 0.0);
  gl_hiRes.uniform3fv(gpuProgram.aLightDir, LightDir);
  gl_hiRes.uniform3fv(gpuProgram.aMonochromeColor, curBodyData.monochromeColor);
  gl_hiRes.uniform1f(gpuProgram.aUseMono, curBodyData.useMono);
  gl_hiRes.uniform1f(gpuProgram.aMPerDegAtEq, curBodyData.eqMetersPerDegree);
}

// 512
function initUniforms_lowResPreview(gpuProgram) {
  gl_hiRes.uniform2f(
    gpuProgram.aLongLatRange,
    viewSize_hiRes * 2,
    viewSize_hiRes
  ); // 218.5 - 202.5, -33.75 - -45.0); // lonMax - lonMin, latMax - latMin
  gl_hiRes.uniform2f(gpuProgram.aHeightRange, curBodyData.elevationMin, curBodyData.elevationMax);
  gl_hiRes.uniform1f(gpuProgram.aReliefScale, curBodyData.hiresReliefScale);
  gl_hiRes.uniform1f(gpuProgram.aHeightScale, 0.0);
  gl_hiRes.uniform3fv(gpuProgram.aLightDir, LightDir);
  gl_hiRes.uniform3fv(gpuProgram.aMonochromeColor, curBodyData.monochromeColor);
  gl_hiRes.uniform1f(gpuProgram.aUseMono, curBodyData.useMono);
  gl_hiRes.uniform1f(gpuProgram.aMPerDegAtEq, curBodyData.eqMetersPerDegree);
}

/*
 * initialize attribute variables used in shader programs
 * gpuProgram -- compiled shader program
 *
 */
function initShaderVariables(gl, gpuProgram) {
  // Obtain a reference to the uniforms and attributes defined in the shaders
  // this is necessary step since the shaders are not written in Javascript
  // but in GLSL

  // used in vertex shader
  gpuProgram.aVertexPosition = gl.getAttribLocation(
    gpuProgram,
    "aVertexPosition"
  );
  gpuProgram.aVertexTextureCoords = gl.getAttribLocation(
    gpuProgram,
    "aVertexTextureCoords"
  );

  gpuProgram.uPMatrix = gl.getUniformLocation(gpuProgram, "uPMatrix");
  gpuProgram.uMVMatrix = gl.getUniformLocation(gpuProgram, "uMVMatrix");

  // for fragment shader
  gpuProgram.aLongLatRange = gl.getUniformLocation(
    gpuProgram,
    "longLatRange"
  );
  gpuProgram.aHeightRange = gl.getUniformLocation(
    gpuProgram,
    "heightRange"
  );
  gpuProgram.aReliefScale = gl.getUniformLocation(
    gpuProgram,
    "reliefScale"
  );
  gpuProgram.aHeightScale = gl.getUniformLocation(gpuProgram, "heightScale");
  gpuProgram.aLightDir = gl.getUniformLocation(gpuProgram, "lightDir");
  gpuProgram.aMPerDegAtEq = gl.getUniformLocation(
    gpuProgram,
    "mPerDegAtEq"
  );
  gpuProgram.texScale = gl.getUniformLocation(gpuProgram, "texScale");

  gpuProgram.aMonochromeColor = gl.getUniformLocation(gpuProgram, "monoColor");
  gpuProgram.aUseMono = gl.getUniformLocation(gpuProgram, "useMono");

  // Setup texture samplers
  gpuProgram.uSampler = gl.getUniformLocation(gpuProgram, "uSampler");
  gpuProgram.uColorSampler = gl.getUniformLocation(
    gpuProgram,
    "uColorSampler"
  ); // jm
  gl.uniform1i(gpuProgram.uSampler, 0);
  gl.uniform1i(gpuProgram.uColorSampler, 1);
}

/**
 * Set the attribute data for Navigation Texture
 * rectangle coords
 * uv coords
 * index array
 */
function initBuffers_nav() {
  textcoords_nav = [
    0.0,
    0.0, //tex-v0
    0.0,
    1.0, //tex-v1
    1.0,
    1.0, //tex-v2
    1.0,
    0.0, //tex-v3
  ];

  vertices_nav = [
    0.5,
    89.5,
    0.0, //v0
    0.5,
    -89.5,
    0.0, //v1
    359.5,
    -89.5,
    0.0, //v2
    359.5,
    89.5,
    0.0, //v3
  ];

  // create indices, order of vertices to use in creating triangles
  indices_nav = [
    3,
    2,
    1, // triangle 1, half of square
    3,
    1,
    0, // triangle 2, other half of square
  ];

  // create buffers

  texCoordBuffer_nav = gl_nav.createBuffer();
  gl_nav.bindBuffer(gl_nav.ARRAY_BUFFER, texCoordBuffer_nav);
  gl_nav.bufferData(
    gl_nav.ARRAY_BUFFER,
    new Float32Array(textcoords_nav),
    gl_nav.STATIC_DRAW
  );

  // now we have the vertices and indices we can create the vertex and indice buffer objects
  // used by GLSL
  vertexBuffer_nav = gl_nav.createBuffer(); // create the vertex buffer object handle
  gl_nav.bindBuffer(gl_nav.ARRAY_BUFFER, vertexBuffer_nav); // bind vertex buffer object handle
  gl_nav.bufferData(
    gl_nav.ARRAY_BUFFER,
    new Float32Array(vertices_nav),
    gl_nav.STATIC_DRAW
  ); //bind data to VBO

  // unbind buffers
  gl_nav.bindBuffer(gl_nav.ARRAY_BUFFER, null); // done with vbo, so unbind

  // create, bind index buffer, for drawing
  indexBuffer_nav = gl_nav.createBuffer();
  gl_nav.bindBuffer(gl_nav.ELEMENT_ARRAY_BUFFER, indexBuffer_nav);
  gl_nav.bufferData(
    gl_nav.ELEMENT_ARRAY_BUFFER,
    new Uint16Array(indices_nav),
    gl_nav.STATIC_DRAW
  );
  gl_nav.bindBuffer(gl_nav.ELEMENT_ARRAY_BUFFER, null);

  // Now, set up grid buffers
  var gridVerts = [];
  var gridIndices = [];
  var curIndex = 0;
  var top = Math.floor(90 / DpanelHeightLat()) * DpanelHeightLat();  // Assume symmetric about equator
  for (var y = -top; y < top + .001; y += DpanelHeightLat()) {
    gridVerts.push(0.0, y, 0.1);
    gridVerts.push(360.0, y, 0.1);
    gridIndices.push(curIndex, curIndex + 1);
    curIndex += 2;
  }

  for (var x = 0; x < 360.001; x += DpanelWidthLon() ) {
    gridVerts.push(x, -90.0, 0.1);
    gridVerts.push(x, 90.0, 0.1);
    gridIndices.push(curIndex, curIndex + 1);
    curIndex += 2;
  }
  gridIndexLength = gridIndices.length;

  // Create the grid vertex buffer
  gridVertBuffer_nav = gl_nav.createBuffer();
  gl_nav.bindBuffer(gl_nav.ARRAY_BUFFER, gridVertBuffer_nav);
  gl_nav.bufferData(
    gl_nav.ARRAY_BUFFER,
    new Float32Array(gridVerts),
    gl_nav.STATIC_DRAW
  );
  gl_nav.bindBuffer(gl_nav.ARRAY_BUFFER, null);

  // Create the grid index buffer
  gridIndexBuffer_nav = gl_nav.createBuffer();
  gl_nav.bindBuffer(gl_nav.ELEMENT_ARRAY_BUFFER, gridIndexBuffer_nav);
  gl_nav.bufferData(
    gl_nav.ELEMENT_ARRAY_BUFFER,
    new Uint16Array(gridIndices),
    gl_nav.STATIC_DRAW
  );
  gl_nav.bindBuffer(gl_nav.ELEMENT_ARRAY_BUFFER, null);

  // Create the vertex buffer for the currently selected quarter-panel
  var curTileVerts = [
    0.0,
    0.0,
    0.2,
    DpanelWidthLon() ,
    0.0,
    0.2,
    DpanelWidthLon() ,
    DpanelHeightLat(),
    0.2,
    0.0,
    DpanelHeightLat(),
    0.2,
    0.0,
    0.0,
    0.2,
  ];

  curPanelVertBuffer_nav = gl_nav.createBuffer();
  gl_nav.bindBuffer(gl_nav.ARRAY_BUFFER, curPanelVertBuffer_nav);
  gl_nav.bufferData(
    gl_nav.ARRAY_BUFFER,
    new Float32Array(curTileVerts),
    gl_nav.STATIC_DRAW
  );
  gl_nav.bindBuffer(gl_nav.ARRAY_BUFFER, null);

  var curViewVerts = [
    0.0,
    0.0,
    0.2,
    DpanelWidthLon() ,
    0.0,
    0.2,
    DpanelWidthLon() ,
    DpanelHeightLat(),
    0.2,
    0.0,
    DpanelHeightLat(),
    0.2,
    0.0,
    0.0,
    0.2,
  ];

  curViewVertBuffer_nav = gl_nav.createBuffer();
  gl_nav.bindBuffer(gl_nav.ARRAY_BUFFER, curViewVertBuffer_nav);
  gl_nav.bufferData(
    gl_nav.ARRAY_BUFFER,
    new Float32Array(curViewVerts),
    gl_nav.STATIC_DRAW
  );
  gl_nav.bindBuffer(gl_nav.ARRAY_BUFFER, null);
}

// Function to swap endianness of 16-bit integers for older maps
function swap16(val) {
  return ((val & 0xFF) << 8)
         | ((val >> 8) & 0xFF);
}

/**
 *
 * @param {WebGLTexture} textureHandle_param webgl texture handel created to refere to the loaded texture
 *    loads an integer height map, manually converts to floating (by devidening by 1.0/max_hgieht)
 */
async function fetchLowResMap(gl, textureHandle_param) {
  //  const response = await fetch("img/LOLA_data/ldem4/ldem_4_int.bin");
  const response = await fetch(curBodyData.lowResPath);
  const arraybuffer = await response.arrayBuffer();
  const uint16_array_buffer =  new Int16Array(arraybuffer);

  // Be careful, some are big-endian instead of little-endian, so convert to little-endian.
  if (curBodyData.lowResEndianness == "MSB")
  {
    for (var i = 0; i < uint16_array_buffer.length; i++)
    {
      uint16_array_buffer[i] = swap16(uint16_array_buffer[i]);
    }
  }
  const float_array_buffer =  new Float32Array(uint16_array_buffer);

  const hData = Float32Array.from(uint16_array_buffer);
  texScale_nav = 1.0;
  gl.bindTexture(gl.TEXTURE_2D, textureHandle_param);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.R16F,
    1440,
    720,
    0,
    gl.RED,
    gl.FLOAT,
    float_array_buffer
  );
  gl.generateMipmap(gl.TEXTURE_2D);

  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MAG_FILTER,
    gl.LINEAR
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_S,
    gl.CLAMP_TO_EDGE
  );
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_WRAP_T,
    gl.CLAMP_TO_EDGE
  );

  /*
  yLimits = [9999999.0, -9999999.0];
  for (var i = 0; i < 1440*720; i++)
  {
    var h = float_array_buffer[i];

    if (h < yLimits[0])
      yLimits[0] = h;
    if (h > yLimits[1])
      yLimits[1] = h;
  }
  console.log("Nav height limits: (" + yLimits[0] + ", " + yLimits[1] + ")");
  */
}

// This function has now been updated to push a TileInfo object into the tileArray rather than
// a generic json object.  This is done at the bottom of the file in the push command where it
// uses Object.assign.
async function fetchHeightMap(baseName, ppd, xRes, yRes, gl) {
  // const response = await fetch("img/LOLA_data/ldem512/8192_8192/ldem_512_45s_00s_180_270_2.bin");
  const tileParamsFile = await fetch(
    "img/LOLA_data/ldem" +
      ppd +
      "/" +
      xRes +
      "_" +
      yRes +
      "/" +
      baseName +
      ".json"
  );

  var jp = await tileParamsFile.json(); // Because he suddenly renamed longitude_min to chunk_longitude_min and other data ... sigh
  var tileParams = new tileInfo(
    jp.sample_bits,
    jp.chunk_latitude_min,
    jp.chunk_latitude_max,
    jp.chunk_longitude_min,
    jp.chunk_longitude_max,
    jp.pix_per_deg,
    jp.columns,
    jp.rows,
    jp.max_value,
    jp.data_type,
    null
  ); // Null is the image data, which will be loaded below

  // This code would be neccessary if non-power-of-two textures weren't supported.
  // tileParams.height_power_of_2 = 1;
  // while (tileParams.height_power_of_2 < tileParams.rows)
  //   tileParams.height_power_of_2 *= 2;
  // tileParams.width_power_of_2 = 1;
  // while (tileParams.width_power_of_2 < tileParams.columns)
  //   tileParams.width_power_of_2 *= 2;

  // For the moment, these files are upside-down, so we need to reverse their latitudes within
  // the NASA tile that they came from.  Assume for the moment that it is lat: 0 --> 45, lon: 90 --> 180
  //
  // No longer have to do this with the new jack-panels???
  //
  // var tmp = tileParams.latitude_min;
  // tileParams.latitude_min = tileParams.latitude_max;
  // tileParams.latitude_max = tmp;
  // tileParams.latitude_min = 45 - tileParams.latitude_min;
  // tileParams.latitude_max = 45 - tileParams.latitude_max;
  // initTileBuffers(tileParams, gl);

  // Now, load the terrain data from the Jack-panel
  var fName =
    "img/LOLA_data/ldem" +
    ppd +
    "/" +
    xRes +
    "_" +
    yRes +
    "/" +
    baseName +
    ".bin";
  const tileDataFile = await fetch(fName);

  const arraybuffer = await tileDataFile.arrayBuffer();
  const int_array_buffer = await new Int16Array(arraybuffer);
  console.log("Loaded file: " + fName);

  texScale_hiRes = 1.0;
  tileParams.image_data = int_array_buffer; // the array of image data.

  return tileParams;
}

function freeTileResources(tileParams, gl) {
  gl.deleteTextures(1, tileParams.tex_object);
  gl.deleteBuffers(1, tileParams.vertex_buffer);
  gl.deleteBuffers(1, tileParams.index_buffer);
  gl.deleteBuffers(1, tileParams.tex_coord_buffer);
}

/**
 * function to async load binary color map file and to populate texture map
 *
 */
async function fetchColorMap_nav(textureColorHandle_param) {
  const response = await fetch(
    "img/LOLA_data/ldem4/colorTableRGB_2048_RGB.dat"
  );
  const arraybuffer = await response.arrayBuffer();
  const float_array_buffer = await new Float32Array(arraybuffer);
  gl_nav.bindTexture(gl_nav.TEXTURE_2D, textureColorHandle_param);
  gl_nav.texImage2D(
    gl_nav.TEXTURE_2D,
    0,
    gl_nav.RGB32F,
    2048,
    1,
    0,
    gl_nav.RGB,
    gl_nav.FLOAT,
    float_array_buffer
  );
  gl_nav.texParameteri(
    gl_nav.TEXTURE_2D,
    gl_nav.TEXTURE_MIN_FILTER,
    gl_nav.LINEAR
  );
  gl_nav.texParameteri(
    gl_nav.TEXTURE_2D,
    gl_nav.TEXTURE_MAG_FILTER,
    gl_nav.LINEAR
  );
  console.log(float_array_buffer.byteLength);

  // Important note!
  //
  // We don't want to generate mipmaps for the colormap textures
  // Since it is a dependent texture call, the active texture level
  // that OpenGL automatically calculates will not be correct.
  // Instead of depending on the size of the rectangle onscreen,
  // the proper level to sample would actually depend on the
  // change of height over the pixel.
  //
  // gl.generateMipmap(gl.TEXTURE_2D);
}

/**
 * function to async load binary color map file and to populate texture map
 *
 */
async function fetchColorMap_hiRes(textureColorHandle_param) {
  const response = await fetch(
    "img/LOLA_data/ldem4/colorTableRGB_2048_RGB.dat"
  );
  const arraybuffer = await response.arrayBuffer();
  const float_array_buffer = await new Float32Array(arraybuffer);
  gl_hiRes.bindTexture(gl_nav.TEXTURE_2D, textureColorHandle_param);
  gl_hiRes.texImage2D(
    gl_nav.TEXTURE_2D,
    0,
    gl_nav.RGB32F,
    2048,
    1,
    0,
    gl_nav.RGB,
    gl_nav.FLOAT,
    float_array_buffer
  );
  gl_hiRes.texParameteri(
    gl_nav.TEXTURE_2D,
    gl_nav.TEXTURE_MIN_FILTER,
    gl_nav.LINEAR
  );
  gl_hiRes.texParameteri(
    gl_nav.TEXTURE_2D,
    gl_nav.TEXTURE_MAG_FILTER,
    gl_nav.LINEAR
  );
  console.log(float_array_buffer.byteLength);
}
/*
 * init the Texture we read from the height file
 */
function initHeigthTexture_nav() {
  heightTex_nav = gl_nav.createTexture();
  gl_nav.bindTexture(gl_nav.TEXTURE_2D, heightTex_nav); // bind texture to textureHandle
  gl_nav.pixelStorei(gl_nav.UNPACK_ALIGNMENT, 1);
  gl_nav.pixelStorei(gl_nav.PACK_ALIGNMENT, 1);

  // Height texture
  // create a default 1x1 texture image temporarily as a place holder
  gl_nav.texImage2D(
    gl_nav.TEXTURE_2D,
    0,
    gl_nav.R16F,
    1,
    1,
    0,
    gl_nav.RED,
    gl_nav.FLOAT,
    null
  );
  gl_nav.generateMipmap(gl_nav.TEXTURE_2D);
  gl_nav.texParameteri(
    gl_nav.TEXTURE_2D,
    gl_nav.TEXTURE_MIN_FILTER,
    gl_nav.LINEAR_MIPMAP_LINEAR
  );
  gl_nav.texParameteri(
    gl_nav.TEXTURE_2D,
    gl_nav.TEXTURE_MAG_FILTER,
    gl_nav.LINEAR
  );
  gl_nav.texParameteri(
    gl_nav.TEXTURE_2D,
    gl_nav.TEXTURE_WRAP_S,
    gl_nav.CLAMP_TO_EDGE
  );
  gl_nav.texParameteri(
    gl_nav.TEXTURE_2D,
    gl_nav.TEXTURE_WRAP_T,
    gl_nav.CLAMP_TO_EDGE
  );

  // now create an image object that will be loaded from server
  // async
  fetchLowResMap(gl_nav, heightTex_nav);

  // Color Texture place-holder
  colorTex_nav = gl_nav.createTexture();
  gl_nav.bindTexture(gl_nav.TEXTURE_2D, colorTex_nav);
  gl_nav.texImage2D(
    gl_nav.TEXTURE_2D,
    0,
    gl_nav.RGB32F,
    1,
    1,
    0,
    gl_nav.RGB,
    gl_nav.FLOAT,
    null
  );
  gl_nav.texParameteri(
    gl_nav.TEXTURE_2D,
    gl_nav.TEXTURE_WRAP_S,
    gl_nav.CLAMP_TO_EDGE
  );
  gl_nav.texParameteri(
    gl_nav.TEXTURE_2D,
    gl_nav.TEXTURE_WRAP_T,
    gl_nav.CLAMP_TO_EDGE
  );
  gl_nav.texParameteri(
    gl_nav.TEXTURE_2D,
    gl_nav.TEXTURE_MIN_FILTER,
    gl_nav.NEAREST
  );
  gl_nav.texParameteri(
    gl_nav.TEXTURE_2D,
    gl_nav.TEXTURE_MAG_FILTER,
    gl_nav.NEAREST
  );

  // now create an image object that will be loaded from server
  // async
  fetchColorMap_nav(colorTex_nav);
}

// This function computes a key into the persistent stoage.  Given a latitude and longitude value, it will compute the quarter-panel
// that the coordinates live in and then compute that quarter-panel's key
//
// There is one potential issue here on the boundary.  This will return one row down on the lower boundary of a quarter-panel, which
// we need to decide on, since the next function returns the lower-left coordinate on this panel.  So, if we leave it like it is,
// panelKey(panelCoords(k)) will not return k, but rather k + rowLength.
//
// The shift of .00001 takes care of this situation, but we should discuss what is really desired here.
function panelKey(latitude, longitude, latitudeSize, longitudeSize) {
  // Warning: this is LATITUDE first
  var panelCol = Math.floor(longitude / longitudeSize);
  var panelRow = Math.floor((90 - (latitude + 0.00001)) / latitudeSize);
  return panelRow * Math.floor(360 / longitudeSize) + panelCol;
}

// This returns the lower-left coordinates of the panel.
function panelCoords(key, latitudeSize, longitudeSize) {
  var nPanelsLongitude = Math.floor(360 / longitudeSize);
  var keyRow = Math.floor(key / nPanelsLongitude);
  var keyCol = key - keyRow * nPanelsLongitude;

  var top = Math.floor(90 / latitudeSize) * latitudeSize;  // Assume we are centered at equator

  return [top - (keyRow + 1) * latitudeSize, keyCol * longitudeSize]; // We add one to keyRow to get the lower-left coordinate
}

// This should take a panel number, call the persistent storage, and then for each of the jack-panels returned, call
// a stripped-down version of fetchHeightMap that sets up the OpenGL buffers.
//
// Right now, I have this set up to compute the set of subpanels (aka Jack-panels) comprising a quarter-panel.
async function createTiles(key, ppd, xRes, yRes, latitudeSize, longitudeSize) {
  // now create an image object that will be loaded from server
  // async

  var result = [];
  var latLon = panelCoords(key, DpanelHeightLat(), DpanelWidthLon() ); // Note, the result is in the order [lat, lon]
  var subpanelHeightDeg = yRes / ppd;
  var subpanelWidthDeg = xRes / ppd;

  for (
    let lon = latLon[1];
    lon < latLon[1] + longitudeSize;
    lon += subpanelWidthDeg
  ) {
    for (
      let lat = latLon[0];
      lat < latLon[0] + latitudeSize;
      lat += subpanelHeightDeg
    ) {
      let name =
        "" +
        lat +
        "_" +
        (lat + subpanelHeightDeg) +
        "_" +
        lon +
        "_" +
        (lon + subpanelWidthDeg);
      result.push(await fetchHeightMap(name, ppd, xRes, yRes, gl_hiRes));
    }
  }
  return result;
}

/**
 * @brief loads sub-tiles into tileArray
 *        newTiles is populated from web-worker
 */
async function initTextures_hiRes_afterLoad(){

  let calculate_img_name = await import('./calculate_img.js');
  let fn = calculate_img_name.img_name_from_lat_lon(mouse_click_latitude, mouse_click_longitude, curBodyData.datasetName);
  console.log(`NASA Tile_v2: ${fn}`);
  let sub_tile_file_names = calculate_img_name.sub_panels_from_lat_lon(mouse_click_latitude, mouse_click_longitude, curBodyData.datasetName);
  console.log(`Sub Tile Files_v2: ${sub_tile_file_names}`);
  console.log(`Size of newTiles: ${newTiles}`);

  // Clear out the old tiles
  for (let i = 0; i < tileArray.length; i++)
    tileArray[i].releaseOpenGLBuffers(gl_hiRes);

  // Now, fill the array with the new tiles, but before we do, we initialize the OpenGL data
  // on them.  This assures that if a tile is in "tileArray" that it is fully setup for
  // OpenGL rendering.
  tileArray = [];
  for (let i = 0; i < newTiles.length; i++) {
    newTiles[i].initializeOpenGLBuffer(gl_hiRes);
    tileArray.push(newTiles[i]);
  }

  let curPanel = panelKey(mouse_click_latitude, mouse_click_longitude, DpanelHeightLat(), DpanelWidthLon() ); //JAMI
  var panelLatLon = panelCoords(curPanel, DpanelHeightLat(), DpanelWidthLon() ); // Remember, panels are defined with (lat, lon)
  viewCenter_hiRes[0] = panelLatLon[1] + DpanelWidthLon()  / 2.0; // but coordinate in OpenGL (like viewCenter) are (x, y) = (lon, lat)
  viewCenter_hiRes[1] = panelLatLon[0] + DpanelHeightLat() / 2.0;

  // 
  // !~!~!~!~!~!~!~!~!~!~!~!     JOHN     !~!~!~!~!~!~!~!~!~!~!~!~!~!
  // Do we need to do this again???
  // 
  // Color Texture ... Need to only do this on the first pass.
  //
  // John: Yes, I will put an if here for the moment, but maybe we should factor this into another function that 
  // only gets called once.
  
  if (colorTex_hiRes == null)
  {
    colorTex_hiRes = gl_hiRes.createTexture();
    gl_hiRes.bindTexture(gl_hiRes.TEXTURE_2D, colorTex_hiRes);
    gl_hiRes.texImage2D(
      gl_nav.TEXTURE_2D,
      0,
      gl_hiRes.RGB32F,
      1,
      1,
      0,
      gl_hiRes.RGB,
      gl_hiRes.FLOAT,
      null
    );
    gl_hiRes.texParameteri(
      gl_hiRes.TEXTURE_2D,
      gl_hiRes.TEXTURE_WRAP_S,
      gl_hiRes.CLAMP_TO_EDGE
    );
    gl_hiRes.texParameteri(
      gl_hiRes.TEXTURE_2D,
      gl_hiRes.TEXTURE_WRAP_T,
      gl_hiRes.CLAMP_TO_EDGE
    );
    gl_hiRes.texParameteri(
      gl_hiRes.TEXTURE_2D,
      gl_hiRes.TEXTURE_MIN_FILTER,
      gl_hiRes.NEAREST
    );
    gl_hiRes.texParameteri(
      gl_hiRes.TEXTURE_2D,
      gl_hiRes.TEXTURE_MAG_FILTER,
      gl_hiRes.NEAREST
    );
    fetchColorMap_hiRes(colorTex_hiRes);
  }

  // Setup of low-res preview texture object for the hi-res window should only be setup once too
  if (previewTexObj == null)
  {
    previewTexObj = gl_hiRes.createTexture();
    gl_hiRes.bindTexture(gl_hiRes.TEXTURE_2D, previewTexObj); // bind texture to textureHandle
    gl_hiRes.pixelStorei(gl_hiRes.UNPACK_ALIGNMENT, 1);
    gl_hiRes.pixelStorei(gl_hiRes.PACK_ALIGNMENT, 1);
  
    // Height texture
    // create a default 1x1 texture image temporarily as a place holder
    gl_hiRes.texImage2D(
      gl_hiRes.TEXTURE_2D,
      0,
      gl_hiRes.R16F,
      1,
      1,
      0,
      gl_hiRes.RED,
      gl_hiRes.FLOAT,
      null
    );
    gl_hiRes.generateMipmap(gl_hiRes.TEXTURE_2D);
    gl_hiRes.texParameteri(
      gl_hiRes.TEXTURE_2D,
      gl_hiRes.TEXTURE_MIN_FILTER,
      gl_hiRes.LINEAR_MIPMAP_LINEAR
    );
    gl_hiRes.texParameteri(
      gl_hiRes.TEXTURE_2D,
      gl_hiRes.TEXTURE_MAG_FILTER,
      gl_hiRes.LINEAR
    );
    gl_hiRes.texParameteri(
      gl_hiRes.TEXTURE_2D,
      gl_hiRes.TEXTURE_WRAP_S,
      gl_hiRes.CLAMP_TO_EDGE
    );
    gl_hiRes.texParameteri(
      gl_hiRes.TEXTURE_2D,
      gl_hiRes.TEXTURE_WRAP_T,
      gl_hiRes.CLAMP_TO_EDGE
    );

    // now create an image object that will be loaded from server
    // async
    fetchLowResMap(gl_hiRes, previewTexObj);

    var previewVerts = [0.0, -90.0, -0.1, 
                        360.0, -90.0, -0.1,
                        360.0, 90.0, -0.1,
                        360.0, 90.0, -0.1,
                        0.0, 90.0, -0.1, 
                        0.0, -90.0, -0.1 ];
    previewVertBuffer = gl_hiRes.createBuffer();
    gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, previewVertBuffer);
    gl_hiRes.bufferData(gl_hiRes.ARRAY_BUFFER, 
      new Float32Array(previewVerts), 
      gl_hiRes.STATIC_DRAW
    );
    gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, null);

    var previewTexCoord = [0.0, 0.0, 
                          1.0, 0.0, 
                          1.0, 1.0, 
                          1.0, 1.0,
                          0.0, 1.0, 
                          0.0, 0.0 ];
    previewTexCoordBuffer = gl_hiRes.createBuffer();
    gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, previewTexCoordBuffer);
    gl_hiRes.bufferData(gl_hiRes.ARRAY_BUFFER, 
      new Float32Array(previewTexCoord), 
      gl_hiRes.STATIC_DRAW
    );
    gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, null);
  }
}



async function initTextures_hiRes(newPanelKey) {
  // Note: We don't have to pre-generate the texture objects because entries will not be
  // stored in the panelArray before they are loaded.  When they are put into the
  // panelArray, they are fully set up and ready to render.  The code in drawScene_hiRes
  // iterates through panelArray ... so if it is empty, no rectangle get renderd
  //
  // This function is called from eventListner--on Nav Panel
  // 1. Downloads the appropriate NASA .img Panel
  // 2. Parses .img into sub-tiles
  // 3. stores in Local Private Storage
  // 
  // left-over code: clear-out old tiles, create textures
  // .....This returns an array of "tileInfo" objects, which have three parts.  The JSON information,
  // .....the "bin" height-map data, and the OpenGL data.  The OpenGL data will be null on this
  // ......return and will be filled in the next for loop.

  curPanel = newPanelKey;

  // could also place mouse_click_longitude/mouse_click_latitude in parameters
  // load module to compute panel coordinates
  let calculate_img_name = await import('./calculate_img.js');

  // compute NASA Gridded Image Name
  let fn = calculate_img_name.img_name_from_lat_lon(mouse_click_latitude, mouse_click_longitude, curBodyData.datasetName);
  console.log(`NASA Tile: ${fn}`);

  // compute sub-tiles that makeup the selected quarter-panel
  let sub_tile_file_names = calculate_img_name.sub_panels_from_lat_lon(mouse_click_latitude, mouse_click_longitude, curBodyData.datasetName);
  console.log(`Sub Tile Files: ${sub_tile_file_names}`);

  // module to load resources selected sub-tiles
  // two parts (1) Download NASA Gridded .img Panel
  // (2) return sub-tiles comprising selected quarter-panel

  let load_resource = null;
  let res = null;
  if (curBodyData.bodyName == "Moon")
  {
    load_resource = await import('./load_resources.js');
    res = await load_resource.load_resources_main(fn, sub_tile_file_names);
  }
  else if (curBodyData.bodyName == "Mars")
  {
    load_resource = await import('./lbl_load_resources.js');
    res = await load_resource.lbl_load_resources_main(fn, sub_tile_file_names);
  }
  console.log('external resources');


  // Clear out the old tiles
  for (let i = 0; i < tileArray.length; i++)
    tileArray[i].releaseOpenGLBuffers(gl_hiRes);

  // Now, fill the array with the new tiles, but before we do, we initialize the OpenGL data
  // on them.  This assures that if a tile is in "tileArray" that it is fully setup for
  // OpenGL rendering.
  tileArray = [];
  for (let i = 0; i < newTiles.length; i++) {
    newTiles[i].initializeOpenGLBuffer(gl_hiRes);
    tileArray.push(newTiles[i]);
  }

  var panelLatLon = panelCoords(curPanel, DpanelHeightLat(), DpanelWidthLon() ); // Remember, panels are defined with (lat, lon)
  viewCenter_hiRes[0] = panelLatLon[1] + DpanelWidthLon()  / 2.0; // but coordinate in OpenGL (like viewCenter) are (x, y) = (lon, lat)
  viewCenter_hiRes[1] = panelLatLon[0] + DpanelHeightLat() / 2.0;
  viewSize_hiRes = DpanelHeightLat() / 2;

  // Color Texture ... Need to only do this on the first pass.
  colorTex_hiRes = gl_hiRes.createTexture();
  gl_hiRes.bindTexture(gl_hiRes.TEXTURE_2D, colorTex_hiRes);
  gl_hiRes.texImage2D(
    gl_nav.TEXTURE_2D,
    0,
    gl_hiRes.RGB32F,
    1,
    1,
    0,
    gl_hiRes.RGB,
    gl_hiRes.FLOAT,
    null
  );
  gl_hiRes.texParameteri(
    gl_hiRes.TEXTURE_2D,
    gl_hiRes.TEXTURE_WRAP_S,
    gl_hiRes.CLAMP_TO_EDGE
  );
  gl_hiRes.texParameteri(
    gl_hiRes.TEXTURE_2D,
    gl_hiRes.TEXTURE_WRAP_T,
    gl_hiRes.CLAMP_TO_EDGE
  );
  gl_hiRes.texParameteri(
    gl_hiRes.TEXTURE_2D,
    gl_hiRes.TEXTURE_MIN_FILTER,
    gl_hiRes.NEAREST
  );
  gl_hiRes.texParameteri(
    gl_hiRes.TEXTURE_2D,
    gl_hiRes.TEXTURE_MAG_FILTER,
    gl_hiRes.NEAREST
  );

  // now create an image object that will be loaded from server
  // async
  fetchColorMap_hiRes(colorTex_hiRes);
}

//////////////////////////////////////////////////////////////////////////
// The following make shaders functions should be able to be collapsed
// We will do this once we package the grid and path shaders into
// arrays to pass them and make sure that this function is general enough
//////////////////////////////////////////////////////////////////////////
/**
 * Compiles shader source and creates a program for GPU
 * @function 
 * @param {array} shaderSource - Array source for shaders
         [0] = source for vertex shader
         [1] = source for frag shader
 * @return {shaderProgram} a webgl Program {contains vertex and fragment shaders
    Notes:
        the vertex and fragment shader source are in external source files.
        
*/
function makeShaders(shaderSource, gl) {
  /*
      set vertexSource = vertex shader source code using ES6,
     */

  console.log("==============Making Shaders....");
  let vertexShader = gl.createShader(gl.VERTEX_SHADER);
  /// gl.shaderSource(vertexShader, vertexSource);
  gl.shaderSource(vertexShader, shaderSource["vsrc"]);
  gl.compileShader(vertexShader);
  if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
    console.error(
      "Compile error in vertex shader",
      gl.getShaderInfoLog(vertexShader)
    );
    return;
  }
  let fragShader = gl.createShader(WebGLRenderingContext.FRAGMENT_SHADER);

  gl.shaderSource(fragShader, shaderSource["fsrc"]);
  gl.compileShader(fragShader);
  if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
    console.error(
      "Compile error in frag shader",
      gl.getShaderInfoLog(fragShader)
    );
    return;
  }

  // Create Program and attach/link shaders

  let gp = gl.createProgram();
  gl.attachShader(gp, vertexShader);
  gl.attachShader(gp, fragShader);
  gl.linkProgram(gp);
  // check for link errors
  if (!gl.getProgramParameter(gp, gl.LINK_STATUS)) {
    console.error(
      "Link error, could not link shaders",
      gl.getProgramInfoLog(gp)
    );
    return;
  }

  return gp;
  ///gpuProgram = gp;
}

// function makeGridShaders(gl) {
//   let vertexShader = gl.createShader(gl.VERTEX_SHADER);
//   gl.shaderSource(vertexShader, lineVertSource);
//   gl.compileShader(vertexShader);
//   if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
//     console.error(
//       "Compile error in grid vertex shader",
//       gl.getShaderInfoLog(vertexShader)
//     );
//     return;
//   }

//   let fragShader = gl.createShader(gl.FRAGMENT_SHADER);
//   gl.shaderSource(fragShader, lineFragSource);
//   gl.compileShader(fragShader);
//   if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
//     console.error(
//       "Compile error in grid frag shader",
//       gl.getShaderInfoLog(fragShader)
//     );
//     return;
//   }

//   // Create Program and attach/link shaders
//   let gp = gl.createProgram();
//   gl.attachShader(gp, vertexShader);
//   gl.attachShader(gp, fragShader);
//   gl.linkProgram(gp);
//   // check for link errors
//   if (!gl.getProgramParameter(gp, gl.LINK_STATUS)) {
//     console.error(
//       "Link error, could not link grid shaders",
//       gl.getProgramInfoLog(gp)
//     );
//     return;
//   }

//   return gp;
// }

// function makeLineShaders_hiRes(gl) {
//   let vertexShader = gl.createShader(gl.VERTEX_SHADER);
//   gl.shaderSource(vertexShader, lineVertSource);
//   gl.compileShader(vertexShader);
//   if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
//     console.error(
//       "Compile error in hiRes line vertex shader",
//       gl.getShaderInfoLog(vertexShader)
//     );
//     return;
//   }

//   let fragShader = gl.createShader(gl.FRAGMENT_SHADER);
//   gl.shaderSource(fragShader, lineFragSource);
//   gl.compileShader(fragShader);
//   if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
//     console.error(
//       "Compile error in hiRes line frag shader",
//       gl.getShaderInfoLog(fragShader)
//     );
//     return;
//   }

//   // Create Program and attach/link shaders
//   let gp = gl.createProgram();
//   gl.attachShader(gp, vertexShader);
//   gl.attachShader(gp, fragShader);
//   gl.linkProgram(gp);
//   // check for link errors
//   if (!gl.getProgramParameter(gp, gl.LINK_STATUS)) {
//     console.error(
//       "Link error, could not link hiRes line shaders",
//       gl.getProgramInfoLog(gp)
//     );
//     return;
//   }

//   return gp;
// }

// function makeProfileShaders_hiRes(gl) {
//   let vertexShader = gl.createShader(gl.VERTEX_SHADER);
//   gl.shaderSource(vertexShader, profileVertSource);
//   gl.compileShader(vertexShader);
//   if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
//     console.error(
//       "Compile error in hiRes line vertex shader",
//       gl.getShaderInfoLog(vertexShader)
//     );
//     return;
//   }

//   let fragShader = gl.createShader(gl.FRAGMENT_SHADER);
//   gl.shaderSource(fragShader, profileFragSource);
//   gl.compileShader(fragShader);
//   if (!gl.getShaderParameter(fragShader, gl.COMPILE_STATUS)) {
//     console.error(
//       "Compile error in hiRes line frag shader",
//       gl.getShaderInfoLog(fragShader)
//     );
//     return;
//   }

//   // Create Program and attach/link shaders
//   let gp = gl.createProgram();
//   gl.attachShader(gp, vertexShader);
//   gl.attachShader(gp, fragShader);
//   gl.linkProgram(gp);
//   // check for link errors
//   if (!gl.getProgramParameter(gp, gl.LINK_STATUS)) {
//     console.error(
//       "Link error, could not link hiRes line shaders",
//       gl.getProgramInfoLog(gp)
//     );
//     return;
//   }

//   return gp;
// }

////////////////////////////////////////////////////////////////////////////////
// These functions deal with drawing and interacting with the profile lines
////////////////////////////////////////////////////////////////////////////////

function posToTex(map, pos) {
  // var tx = (pos[0] - map.longitude_min) / (map.longitude_max - map.longitude_min);
  // var ty = (pos[1] - map.latitude_min) / (map.latitude_max - map.latitude_min);

  // var s_limit = map.columns / map.width_power_of_2;  // This will go away when the textures are not forced to be powers of 2
  // var t_limit = map.rows / map.height_power_of_2;    // Maybe keep this parameter for backwards compatiblity if some hardware doesn't support?
  // return [tx * s_limit, ty * t_limit];

  var tx =
    (pos[0] - map.longitude_min) / (map.longitude_max - map.longitude_min);
  var ty = (pos[1] - map.latitude_min) / (map.latitude_max - map.latitude_min);

  // Assume that u and v start at 0 and go to a limit <= 1
  return [tx, map.tex_inverted ? 1.0 - ty : ty]; // Need to invert the latitude texture coordinate if the map is inverted.
}

function inTile(map, pos) {
  return (
    pos[0] >= map.longitude_min &&
    pos[0] < map.longitude_max &&
    pos[1] >= map.latitude_min &&
    pos[1] < map.latitude_max
  );
}

function findTile(pos) {
  for (let i = 0; i < tileArray.length; i++) {
    if (inTile(tileArray[i], pos)) return tileArray[i];
  }
  return null;
}

function intersectBorder(map, pos0, pos1) {
  var tTmp,
    tIntersect = 1e9; // Beyond the 1.0 = no intersection

  // Want an intersection that is not at pos0
  pos0[0] += 0.00001 * (pos1[0] - pos0[0]);
  pos0[1] += 0.00001 * (pos1[1] - pos1[1]);

  tTmp = (map.longitude_min - pos0[0]) / (pos1[0] - pos0[0]);
  if (tTmp >= 0) tIntersect = Math.min(tIntersect, tTmp);

  tTmp = (map.longitude_max - pos0[0]) / (pos1[0] - pos0[0]);
  if (tTmp >= 0) tIntersect = Math.min(tIntersect, tTmp);

  tTmp = (map.latitude_min - pos0[1]) / (pos1[1] - pos0[1]);
  if (tTmp >= 0) tIntersect = Math.min(tIntersect, tTmp);

  tTmp = (map.latitude_max - pos0[1]) / (pos1[1] - pos0[1]);
  if (tTmp >= 0) tIntersect = Math.min(tIntersect, tTmp);

  return tIntersect;
}

function initializeToolBuffers() {
  // Create the vertex buffer object used by GLSL to draw the profile path.  Note that we will be using
  // DrawArrays to do this instead of using an index buffer for simplicity since we will be using a line
  // strip and we do not need to explicitly share vertices with an index buffer.
  pathVertBuffer = gl_hiRes.createBuffer(); // create the vertex buffer object handle
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, pathVertBuffer); // bind vertex buffer object handle
  gl_hiRes.bufferData(
    gl_hiRes.ARRAY_BUFFER,
    new Float32Array(pathVerts),
    gl_hiRes.STATIC_DRAW
  ); //bind data to VBO
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, null); // done with vbo, so unbind

  // Create the vertex buffer and other objects for the area boundary rectangle
  areaRectVertexBuffer = gl_hiRes.createBuffer();
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, areaRectVertexBuffer);
  gl_hiRes.bufferData(
    gl_hiRes.ARRAY_BUFFER,
    new Float32Array(areaRectVertices),
    gl_hiRes.STATIC_DRAW
  );
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, null);

  // Create the vertex buffer and other objects for the area inscribed ellipse
  areaEllipseVertexBuffer = gl_hiRes.createBuffer();
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, areaEllipseVertexBuffer);
  gl_hiRes.bufferData(
    gl_hiRes.ARRAY_BUFFER,
    new Float32Array(areaEllipseVertices),
    gl_hiRes.STATIC_DRAW
  );
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, null);

  // Create the vertex buffer and other objects for the banner text rectangles
  bannerVertexBuffer = gl_hiRes.createBuffer();
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, bannerVertexBuffer);
  gl_hiRes.bufferData(gl_hiRes.ARRAY_BUFFER, 
    new Float32Array(bannerVerts), 
    gl_hiRes.STATIC_DRAW
  );
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, null);

  bannerTexBuffer = gl_hiRes.createBuffer();
  gl_hiRes.bindBuffer(gl_hiRes.ARRAY_BUFFER, bannerTexBuffer);
  gl_hiRes.bufferData(gl_hiRes.ARRAY_BUFFER, 
    new Float32Array(bannerTexCoord),
    gl_hiRes.STATIC_DRAW
  );

  bannerTextureObj = gl_hiRes.createTexture();
  gl_hiRes.bindTexture(gl_hiRes.TEXTURE_2D, bannerTextureObj);
  gl_hiRes.texImage2D(
    gl_hiRes.TEXTURE_2D,
    0,
    gl_hiRes.RGBA,
    1,
    1,
    0,
    gl_hiRes.RGBA,
    gl_hiRes.UNSIGNED_BYTE,
    null
  );
  gl_hiRes.texParameteri(
    gl_hiRes.TEXTURE_2D,
    gl_hiRes.TEXTURE_WRAP_S,
    gl_hiRes.CLAMP_TO_EDGE
  );
  gl_hiRes.texParameteri(
    gl_hiRes.TEXTURE_2D,
    gl_hiRes.TEXTURE_WRAP_T,
    gl_hiRes.CLAMP_TO_EDGE
  );
  gl_hiRes.texParameteri(
    gl_hiRes.TEXTURE_2D,
    gl_hiRes.TEXTURE_MIN_FILTER,
    gl_hiRes.LINEAR_MIPMAP_LINEAR
  );
  gl_hiRes.texParameteri(
    gl_hiRes.TEXTURE_2D,
    gl_hiRes.TEXTURE_MAG_FILTER,
    gl_hiRes.LINEAR
  );
  gl_hiRes.bindTexture(gl_hiRes.TEXTURE_2D, null);
}

function buildProfileSourceData(maxSize) {
  var profileInput = [];
  var tile = null;
  var result = [];
  var nPathSeg = pathVerts.length / 3 - 1;
  var nSteps = Math.floor(maxSize / nPathSeg);
  var dLast = 0.0;

  for (let j = 0; j < nPathSeg; j++) {
    let pos0 = [pathVerts[3 * j], pathVerts[3 * j + 1]];
    let pos1 = [pathVerts[3 * (j + 1)], pathVerts[3 * (j + 1) + 1]];

    tile = findTile(pos0); // Assume for the moment that this tile contains the whole path.

    var pLast = pos0;
    var uvLast = posToTex(tile, pos0);

    // The profileInput is an array of 4d-points with coordinates contiguously stored in the array.
    // The values are [t, d, uv.s, uv.t].  Note that the latitude and longitude in p are not needed
    // for the generation of the profile, only the uv coordinates on the current map.
    profileInput = [];
    profileInput.push((j / nPathSeg) * maxSize, dLast, uvLast[0], uvLast[1]);
    for (let i = 1; i < nSteps; i++) {
      let t = i / (nSteps - 1); // Note: javascript does not have integers ... only "number"
      let pNew = [
        pos0[0] + t * (pos1[0] - pos0[0]),
        pos0[1] + t * (pos1[1] - pos0[1]),
      ];

      let theta0 = (pLast[0] * Math.PI) / 180.0;
      let phi0 = (pLast[1] * Math.PI) / 180.0;
      let vx = Math.cos(theta0) * Math.cos(phi0);
      let vy = Math.sin(theta0) * Math.cos(phi0);
      let vz = Math.sin(phi0);

      let theta1 = (pNew[0] * Math.PI) / 180.0;
      let phi1 = (pNew[1] * Math.PI) / 180.0;
      let wx = Math.cos(theta1) * Math.cos(phi1);
      let wy = Math.sin(theta1) * Math.cos(phi1);
      let wz = Math.sin(phi1);

      let geodessicAngle = Math.acos(vx * wx + vy * wy + vz * wz);
      let dNew = dLast + (curBodyData.eqMetersPerDegree * geodessicAngle * 180.0) / Math.PI;

      // See if it intersects the border.  If it does, we need to split the segment so that
      // we can look up the new tile and restart a new path array.  So, we compute the intersection
      // and interpolate the distance (assuming the step is small enough that the distance varies
      // linearly) and then push the intersection point as the end of the current path and the beginning
      // of the new path on the new tile.
      let tIntersect = intersectBorder(tile, pLast, pNew);
      if (tIntersect >= 0 && tIntersect <= 1.0) {
        // Floating point error :)
        let pTmp = [
          pLast[0] + tIntersect * (pNew[0] - pLast[0]),
          pLast[1] + tIntersect * (pNew[1] - pLast[1]),
        ];
        let tTmp = t + (1 / (nSteps - 1)) * tIntersect; // Get the t-inbetween.
        let dTmp = dLast + (dNew - dLast) * tIntersect;
        let uvTmp = posToTex(tile, pTmp);
        profileInput.push(
          ((j + tTmp) / nPathSeg) * maxSize,
          dTmp,
          uvTmp[0],
          uvTmp[1]
        );
        result.push([tile, profileInput]); // Push this tile's portion into the result

        // Now, find the new tile
        tile = findTile(pNew);
        uvTmp = posToTex(tile, pTmp); // Have to re-do it on the new tile.

        // And start a new profileInput array
        profileInput = [
          ((j + tTmp) / nPathSeg) * maxSize,
          dTmp,
          uvTmp[0],
          uvTmp[1],
        ];
      }

      let uvNew = posToTex(tile, pNew);
      profileInput.push(
        ((j + t) / nPathSeg) * maxSize,
        dNew,
        uvNew[0],
        uvNew[1]
      );
      pLast = pNew;
      dLast = dNew;
      uvLast = uvNew;
    }
    result.push([tile, profileInput]);
  }
  profileTotalDist = dLast;
  return result;
}

/////////////////////////////////////////////////////////////////////////////////
// These functions render the profile buffer to a renderbuffer and then read
// the result out of OpenGL to send the data to D3 for drawing
/////////////////////////////////////////////////////////////////////////////////
function setupProfileRenderbuffer(gl, maxSize) {
  profileFramebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, profileFramebuffer);

  profileColorBuffer = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, profileColorBuffer);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA32F, maxSize, 1);
  gl.framebufferRenderbuffer(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.RENDERBUFFER,
    profileColorBuffer
  );

  var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status != gl.FRAMEBUFFER_COMPLETE)
    console.log("Framebuffer is not complete.");

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function renderHeightProfile(gl, maxSize) {
  profileData = buildProfileSourceData(maxSize);

  if (profileFramebuffer == null) setupProfileRenderbuffer(gl_hiRes, 1024);

  gl.bindFramebuffer(gl.FRAMEBUFFER, profileFramebuffer);
  gl.useProgram(profileProgram);

  gl.viewport(0, 0, maxSize, 1);

  //uniform mat4 uPMatrix;
  //in vec4 pos;
  var pMatrix = mat4.create();
  mat4.ortho(0, maxSize, -1.0, 1.0, -1.0, 1.0, pMatrix);

  var vertexPosition = gl.getAttribLocation(profileProgram, "pos");
  var uPMatrix = gl.getUniformLocation(profileProgram, "uPMatrix");
  var uTex = gl.getUniformLocation(profileProgram, "heightMap");

  gl.uniformMatrix4fv(uPMatrix, false, pMatrix);

  var profileVertBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, profileVertBuffer);

  for (let i = 0; i < profileData.length; i++) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, profileData[i][0].tex_object);
    gl.uniform1i(uTex, 0);

    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array(profileData[i][1]),
      gl.STATIC_DRAW
    );

    gl.enableVertexAttribArray(vertexPosition);
    gl.bindBuffer(gl.ARRAY_BUFFER, profileVertBuffer);
    gl.vertexAttribPointer(vertexPosition, 4, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.LINE_STRIP, 0, profileData[i][1].length / 4);
  }

  var profilePoints = new Float32Array(maxSize * 4);
  gl.readBuffer(gl.COLOR_ATTACHMENT0);
  gl.readPixels(0, 0, maxSize, 1, gl.RGBA, gl.FLOAT, profilePoints);

  ClearSlopeDisplay(); // Clear the slope calculation

  if (profile_svg == null) CreateProfileGraph(profilePoints);
  else UpdateProfileGraph(profilePoints);

  gl.bindBuffer(gl.ARRAY_BUFFER, null);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Now, draw rectangle with ellipse
}

function ClearPlots()
{
  pathVerts = [];
  profileData = [];
  document.getElementById("imgDownload").setAttribute("style", "display:none");
  document.getElementById("imgAreaThreeD").setAttribute("style", "display:none");
  areaRectDefined = false;
   
  profileSlopePoints = [];
  profileSlopePoints.push({x: -1000, y: 0, color: "red", size: 3});
  profileSlopePoints.push({x: -1000, y: 0, color: "red", size: 3});
  profileSlopePoints.push({x: -1000, y: 0, color: "red", size: 5});  // One extra for the point that follows the cursor
  
  UpdateProfileGraph([]);
  drawScene_hiRes();
}

function CreateProfileGraph(graphData) {
  // Declare the chart dimensions and margins.
  const width = 530;
  const height = 260;
  const marginTop = 10;
  const marginRight = 10;
  const marginBottom = 40;
  const marginLeft = 60;

  profile_svg = d3
    .select("svg")
    .attr("width", width + marginLeft + marginRight)
    .attr("height", height + marginTop + marginBottom)
    .append("g")
    .attr("transform", "translate(" + marginLeft + "," + marginTop + ")");

  var graphRect = profile_svg.append("rect")
    .attr("fill", "black")
    .attr("pointer-events", "all")
    .attr("width", width)
    .attr("height", height)

  var tmp = Array.from(graphData);
  profileGraphPoints = [];
  while (tmp.length) profileGraphPoints.push(tmp.splice(0, 4));

  // Declare the x (horizontal position) scale.
  profile_xScale = d3
    .scaleLinear()
    // .domain(xLimits)
    .domain(d3.extent(profileGraphPoints.map((x) => x[0])))
    .range([0, width]);
  profile_xAxis = d3.axisBottom(profile_xScale);

  // Declare the y (vertical position) scale.
  profile_yScale = d3
    .scaleLinear()
    .domain(d3.extent(profileGraphPoints.map((x) => x[1])))
    .range([height, 0]);
  profile_yAxis = d3.axisLeft(profile_yScale);

  // Add the x-axis.
  profile_svg
    .append("g")
    .attr("transform", `translate(0,${height})`)
    .attr("class", "xAxis")
    .call(profile_xAxis);

  profile_svg
    .append("text")
    .attr("class", "x label")
    .attr("text-anchor", "end")
    .attr("x", width)
    .attr("y", height + marginBottom - 8)
    .attr("fill", "yellow")
    .text("Surface Distance (km)");

  // Add the y-axis.
  profile_svg
    .append("g")
    .attr("transform", `translate(0,0)`)
    .attr("class", "yAxis")
    .call(profile_yAxis);

  profile_svg
    .append("text")
    .attr("class", "y label")
    .attr("text-anchor", "end")
    .attr("y", -marginLeft + 2)
    .attr("dy", ".75em")
    .attr("transform", "rotate(-90)")
    .attr("fill", "yellow")
    .text("Surface Elevation (m)");

  profile_graph = profile_svg
    .append("path")
    .datum(profileGraphPoints)
    .attr("fill", "none")
    .attr("stroke", "yellow")
    .attr("stroke-width", 2)
    .attr("class", "profileCurve")
    .attr(
      "d",
      d3
        .line()
        .x(function (d) {
          return profile_xScale(d[0]);
        })
        .y(function (d) {
          return profile_yScale(d[1]);
        })
    );

    profileSlopePoints.push({x: -1000, y: 0, color: "red", size: 3});
    profileSlopePoints.push({x: -1000, y: 0, color: "red", size: 3});
    profileSlopePoints.push({x: -1000, y: 0, color: "red", size: 5});  // One extra for the point that follows the cursor
    var profile_points = profile_svg.selectAll(".profilePoints")
      .data(profileSlopePoints)
      .attr("class", "profilePoints")
      .attr("fill", function(d) { return d.color })
      .attr("r", function(d) { return d.size })
      .attr("cx", function (d) { return profile_xScale(d.x) })
      .attr("cy", function (d) { return profile_yScale(d.y) });
  
    slopeTooltip = profile_svg.append("g");
    const text = slopeTooltip.selectAll("text")
    .data([,])
    .join("text")
    .call(text => text
      .selectAll("tspan")
      .data(["" , ""])
      .join("tspan")
        .attr("x", 500)
        .attr("y", (_, i) => `${i * 1.1}em`)
        .attr("fill", "white")
        .text(d => d));
  
    var svg = d3.select("svg");
    document.onclick = (e) => {
      if (e.target.id == "graph_div")
      {
        if (nSlopePoints == 2)
        {
          nSlopePoints = 0;
          profileSlopePoints[0] = [-1000, 0, 0, 0];
          profileSlopePoints[1] = [-1000, 0, 0, 0];
        }
        slopeInitialized = true;
        var d = d3.pointer(e, svg.node());
        var px = (profile_xScale.invert(d[0] - marginLeft));
        var py = (profile_yScale.invert(d[1] - marginTop));
        // console.log(e.target.id);
        // console.log((px) + ", " + (py));
  
        let i = 0;
        while(profileGraphPoints[i][0] < px)
          i++;
  
        profileSlopePoints[nSlopePoints] = { x: profileGraphPoints[i][0], y: profileGraphPoints[i][1], color: "red", size: 3 };
        nSlopePoints++;
  
        var pointGroup = profile_svg.selectAll("circle")
          .data(profileSlopePoints);

        pointGroup.enter()
          .append("circle")
          .attr("class", "profilePoints")
          .merge(pointGroup)
          .attr("fill", function(d) { return d.color })
          .attr("r", function(d) { return d.size })
          .attr("class", "profilePoints")
          .attr("cx", function(d) { return profile_xScale(d.x) })
          .attr("cy", function(d) { return profile_yScale(d.y) })
          
        pointGroup.transition()
          .duration(100);
  
        if (nSlopePoints == 2)
        {
          var slope = (profileSlopePoints[1].y - profileSlopePoints[0].y) / (1000 * (profileSlopePoints[1].x - profileSlopePoints[0].x));
          // LogNewParagraph();
          // LogPrint("Profile:");
          let elev1 = getHeightFromTileArray(pathVerts[1], pathVerts[0]);  // pathVerts is a 1d array of triples
          let elev2 = getHeightFromTileArray(pathVerts[4], pathVerts[3]);  // pathVerts is a 1d array of triples
          // LogPrint("Endpoint 1, [Lat: " + (pathVerts[1]).toFixed(2) + ", Lon: " + (pathVerts[0]).toFixed(2) + ", Elev: " + elev1.toFixed(2) + "]", 
          //          12, "yellow");
          // LogPrint("Endpoint 2, [Lat: " + (pathVerts[4]).toFixed(2) + ", Lon: " + (pathVerts[3]).toFixed(2) + ", Elev: " + elev2.toFixed(2) + "]", 
          //          12, "yellow");
          LogPrint("Point-to-Point Slope:", 12);
          let distPct1 = profileSlopePoints[0].x / (profileTotalDist / 1000.0);  // Remember, we divided by 1,000m on the distance scale.
          let distPct2 = profileSlopePoints[1].x / (profileTotalDist / 1000.0);
          let lat1 = pathVerts[1] + (pathVerts[4] - pathVerts[1]) * distPct1;
          let lon1 = pathVerts[0] + (pathVerts[3] - pathVerts[0]) * distPct1;
          elev1 = getHeightFromTileArray(lat1, lon1);
          let lat2 = pathVerts[1] + (pathVerts[4] - pathVerts[1]) * distPct2;
          let lon2 = pathVerts[0] + (pathVerts[3] - pathVerts[0]) * distPct2;
          elev2 = getHeightFromTileArray(lat2, lon2);
          LogPrint("Slope point 1: [Lat: " + lat1.toFixed(3) + ", Lon: " + lon1.toFixed(2) + ", Elev: " + elev1.toFixed(2) + "]", 24);
          LogPrint("Slope point 2: [Lat: " + lat2.toFixed(3) + ", Lon: " + lon2.toFixed(2) + ", Elev: " + elev2.toFixed(2) + "]", 24);
          LogPrint("Change in elevation: " + ((profileSlopePoints[1].y - profileSlopePoints[0].y)).toFixed(2) + "m", 24);
          LogPrint("Distance along surface: " + (1000 * (profileSlopePoints[1].x - profileSlopePoints[0].x)).toFixed(2) + "m", 24);
          LogPrint("Slope: " + (slope).toFixed(2), 24); 
        }  
      }
    }

    document.onmousemove = (e) => {
      if (e.target.id == "graph_div" && profileGraphPoints != null && profileGraphPoints.length > 0)
      {
        var d = d3.pointer(e, svg.node());
        var px = (profile_xScale.invert(d[0] - marginLeft));
        var py = (profile_yScale.invert(d[1] - marginTop));
        // console.log(e.target.id);
        // console.log((px) + ", " + (py));
  
        let i = 0;
        while(profileGraphPoints[i][0] < px)
          i++;

        profileSlopePoints[2].x = profileGraphPoints[i][0];
        profileSlopePoints[2].y = profileGraphPoints[i][1];
        profileSlopePoints[2].color = "orange";
        profileSlopePoints[2].size = 6.0;

        let distPct = profileGraphPoints[i][0] / (profileTotalDist / 1000.0);  // Remember, we divided by 1,000m on the distance scale.
        let lat = pathVerts[1] + (pathVerts[4] - pathVerts[1]) * distPct;
        let lon = pathVerts[0] + (pathVerts[3] - pathVerts[0]) * distPct;
        let elev = getHeightFromTileArray(lat, lon);
   
        var pointGroup = profile_svg.selectAll("circle")
          .data(profileSlopePoints);
   
        pointGroup.enter()
          .append("circle")
          .attr("class", "profilePoints")
          .merge(pointGroup)
          .attr("fill", function(d) { return d.color })
          .attr("r", function(d) { return d.size })
          .attr("class", "profilePoints")
          .attr("cx", function(d) { return profile_xScale(d.x) })
          .attr("cy", function(d) { return profile_yScale(d.y) })
          
        pointGroup.transition()
          .duration(100);
  
        const text = slopeTooltip.selectAll("text")
          .data([,])
          .join("text")
          .call(text => text
            .selectAll("tspan")
            .data(["", "Lat: " + lat.toFixed(2) + ", Lon: " + lon.toFixed(2) + ", Elevation: " + elev.toFixed(2) + "m"])
            .join("tspan")
              .attr("x", 10)
              .attr("y", (_, i) => `${i * 1.1}em`)
              .attr("fill", "white")
              .text(d => d));

        curSlopeCursor = [lon, lat];
        drawScene_hiRes();
      }
      else if (profileSlopePoints[2].x != -1000.0)
      {
        profileSlopePoints[2].x = -1000.0;
        profileSlopePoints[2].y = 0.0;
        profileSlopePoints[2].color = "orange";
        profileSlopePoints[2].size = 4.0;
  
        var pointGroup = profile_svg.selectAll("circle")
          .data(profileSlopePoints);
    
        pointGroup.enter()
          .append("circle")
          .attr("class", "profilePoints")
          .merge(pointGroup)
          .attr("fill", function(d) { return d.color })
          .attr("r", function(d) { return d.size })
          .attr("class", "profilePoints")
          .attr("cx", function(d) { return profile_xScale(d.x) })
          .attr("cy", function(d) { return profile_yScale(d.y) })
          
        pointGroup.transition()
          .duration(100);
  
        const text = slopeTooltip.selectAll("text")
          .data([,])
          .join("text")
          .call(text => text
            .selectAll("tspan")
            .data(["", ""])
            .join("tspan")
              .attr("x", 10)
              .attr("y", (_, i) => `${i * 1.1}em`)
              .attr("fill", "white")
              .text(d => d));
        curSlopeCursor = [];
        drawScene_hiRes();
      }
    }

    // const i = bisect(aapl, x.invert(d3.pointer(event)[0]));
    // tooltip.style("display", null);
    // tooltip.attr("transform", `translate(${x(aapl[i].Date)},${y(aapl[i].Close)})`);

    // const path = tooltip.selectAll("path")
    //   .data([,])
    //   .join("path")
    //     .attr("fill", "white")
    //     .attr("stroke", "black");

    // const text = tooltip.selectAll("text")
    //   .data([,])
    //   .join("text")
    //   .call(text => text
    //     .selectAll("tspan")
    //     .data([formatDate(aapl[i].Date), formatValue(aapl[i].Close)])
    //     .join("tspan")
    //       .attr("x", 0)
    //       .attr("y", (_, i) => `${i * 1.1}em`)
    //       .attr("font-weight", (_, i) => i ? null : "bold")
    //       .text(d => d));

    // size(text, path);
  //}
    
  //    var mouse_g = svg.append('g').classed('mouse', true).style('display', 'none');
  //    mouse_g.append('circle').attr('r', 3).attr("stroke", "steelblue");
  //    mouse_g.append('text');
  
    // svg.on("mousemove", function(mouse) {
    //   var [x_cord,y_cord] = d3.pointer(mouse);
    //   var ratio = x_cord / svg.width;
    //   var xMouse = profile_xScale.invert(xLimits[0] + ratio * (xLimits[1] - xLimits[0]));

    //   // const cnt = data.find(d => d.year === current_year).cnt;
    //   // mouse_g.attr('transform', `translate(${x(current_year)},${0})`);
    //   // mouse_g.select('text').text(`year: ${current_year}, ${cnt}/${cnt_sum} papers`)
    //   //   .attr('text-anchor', current_year < (min_year + max_year) / 2 ? "start" : "end");
    //   // mouse_g.select('circle').attr('cy', y(cnt));
    // });
          
  // This will be useful later when we want to put in the actual data points
  //
  // svg.selectAll("circle")
  // .data(dataset)
  // .enter()
  // .append("circle")
  // .attr("r", 3)
  // .attr("fill", "white")
  // .attr("cx", function(d)
  //       {
  //         return x(d[0]);
  //       })
  // .attr("cy", function(d)
  //       {
  //         return y(d[1]);
  //       });
}

function ClearSlopeDisplay() {
  if (slopeInitialized)
  {
    nSlopePoints = 0;
    profileSlopePoints[0] = [-1000, 0, 0, 0];
    profileSlopePoints[1] = [-1000, 0, 0, 0];

    var pointGroup = profile_svg.selectAll("circle")
    .data(profileSlopePoints);

  pointGroup.enter()
    .append("circle")
    .attr("class", "profilePoints")
    .merge(pointGroup)
    .attr("fill", "red")
    .attr("r", 3.0)
    .attr("class", "profilePoints")
    .attr("cx", function(d) { return profile_xScale(d[0]) })
    .attr("cy", function(d) { return profile_yScale(d[1]) })
    
  pointGroup.transition()
    .duration(100);

  const text = slopeTooltip.selectAll("text")
    .data([,])
    .join("text")
    .call(text => text
      .selectAll("tspan")
      .data(["", ""])
      .join("tspan")
        .attr("x", 10)
        .attr("y", (_, i) => `${i * 1.1}em`)
        .attr("fill", "white")
        .text(d => d));
  }
}

function UpdateProfileGraph(graphData) {
  var tmp = Array.from(graphData);
  profileGraphPoints = [];
  while (tmp.length) profileGraphPoints.push(tmp.splice(0, 4));

  profile_xScale.domain(d3.extent(profileGraphPoints.map((x) => x[0])));
  // console.log("x-range: " + d3.extent(profileGraphPoints.map((x) => x[0])));
  profile_svg
    .selectAll(".xAxis")
    .transition()
    .duration(100)
    .call(profile_xAxis);

  profile_yScale.domain(d3.extent(profileGraphPoints.map((x) => x[1])));
  profile_svg
    .selectAll(".yAxis")
    .transition()
    .duration(100)
    .call(profile_yAxis);

  var pathGroup = profile_svg.selectAll(".profileCurve").datum(profileGraphPoints);

  pathGroup
    .enter()
    .append("path")
    .attr("class", "profileCurve")
    .merge(pathGroup)
    .transition()
    .duration(100)
    .attr("fill", "none")
    .attr("stroke", "yellow")
    .attr("stroke-width", 2)
    .attr(
      "d",
      d3
        .line()
        .x(function (d) {
          return profile_xScale(d[0]);
        })
        .y(function (d) {
          return profile_yScale(d[1]);
        })
    );

  var pointGroup = profile_svg.selectAll(".profilePoint")
    .data(profileGraphPoints)

  pointGroup.enter()
    .append("circle")
    .merge(pointGroup)
    .transition()
    .duration(100)
    .attr("class", "profilePoint")
    .attr("fill", "red")
    .attr("cx", function (d) { return profile_xScale(d[0]) })
    .attr("cy", function (d) { return profile_yScale(d[1]) });

}

function setupAreaMesh(gl)
{
  var lonMin, lonMax, latMin, latMax;

  lonMin = lonMax = areaRectVertices[0]; // Remember, x = longitude
  latMin = latMax = areaRectVertices[1];

  lonMin = Math.min(lonMin, Math.min(Math.min(areaRectVertices[3], areaRectVertices[6]), areaRectVertices[9])); // Assume that the last vertex equals the first
  latMin = Math.min(latMin, Math.min(Math.min(areaRectVertices[4], areaRectVertices[7]), areaRectVertices[10])); // Assume that the last vertex equals the first
  lonMax = Math.max(lonMin, Math.max(Math.max(areaRectVertices[3], areaRectVertices[6]), areaRectVertices[9])); // Assume that the last vertex equals the first
  latMax = Math.max(latMin, Math.max(Math.max(areaRectVertices[4], areaRectVertices[7]), areaRectVertices[10])); // Assume that the last vertex equals the first

  tileArray.forEach((element) => element.setupTileAreaMesh(gl, lonMin, latMin, lonMax, latMax));
}

