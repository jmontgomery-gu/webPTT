#version 300 es

in vec3 aVertexPosition;
in vec2 aVertexTextureCoords;

uniform sampler2D uSampler;
uniform mat4 uMVMatrix;
uniform mat4 uPMatrix;

uniform float heightScale;
uniform vec2 longLatRange;
uniform vec2 heightRange;
uniform float reliefScale;
uniform vec3 lightDir;
uniform vec3 monoColor;
uniform float useMono;
uniform float mPerDegAtEq;

out vec2 vTextureCoord;
out vec2 LongLat;

void main(void) 
{
        vec3 pos = aVertexPosition;
        LongLat = aVertexPosition.xy * 3.14159 / 180.0;   // Converting to radians for map projection slope adjustment

        // Turn height sampling off if not used (optimizer should work since heightScale is uniform)
        // Note that the x,y coordinates are in degrees, so we have to account for that when setting the height
        if (heightScale > .001)                 
                pos.z = texture(uSampler, aVertexTextureCoords).r * heightScale / (mPerDegAtEq * cos(LongLat.y));

        vTextureCoord = aVertexTextureCoords;
        gl_Position = uPMatrix * uMVMatrix * vec4(pos, 1.0);
}
