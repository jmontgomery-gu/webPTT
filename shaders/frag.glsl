#version 300 es

precision highp float;

in highp vec2 vTextureCoord;
in vec2 LongLat;

uniform sampler2D uSampler;
uniform sampler2D uColorSampler; //jm
uniform float texScale;
uniform vec2 longLatRange;
uniform vec2 heightRange;
uniform float reliefScale;
uniform vec3 lightDir;
uniform vec3 monoColor;
uniform float useMono;
uniform float mPerDegAtEq;

out vec4 fragColor;

void main(void) 
{
    vec2 height0, height1;
    float height;
    vec4 color;

    float texResolution = 5760.0; // float(min(textureSize(uSampler, 0).x, textureSize(uSampler, 0).y)); 
    float texelWidth = 1.0 / texResolution;
    vec2 tex = vTextureCoord; 
    height = texture(uSampler, tex).r / texScale;
    height = (height - heightRange[0]) / (heightRange[1] - heightRange[0]);   // Convert to a [0 --> 1] value for the color lookup. 
    vec4 colorFalse = texture(uColorSampler, vec2(height, 0.0));
    vec4 colorMono = vec4((height + .35) * monoColor + vec3(.2, .2, .2), 1.0);  // .35 is an ambient "minimum" light, and the .2 gray brightens everything up uniformly
    color = mix(colorFalse, colorMono, useMono);

    // We need to measure the clamped distance here on each so that we can properly calculate the 
    // slope on the
    tex = clamp(vTextureCoord, texelWidth, 1.0 - texelWidth);
    vec2 uvDeriv = max(vec2(dFdx(vTextureCoord.x) / 2.0, dFdy(vTextureCoord.y) / 2.0), vec2(texelWidth));
    vec2 coordX0 = clamp(tex - vec2(uvDeriv.x, 0.0), texelWidth, 1.0 - texelWidth);
    vec2 coordX1 = clamp(tex + vec2(uvDeriv.x, 0.0), texelWidth, 1.0 - texelWidth);
    vec2 coordY0 = clamp(tex - vec2(0.0, uvDeriv.y), texelWidth, 1.0 - texelWidth);
    vec2 coordY1 = clamp(tex + vec2(0.0, uvDeriv.y), texelWidth, 1.0 - texelWidth);
    height0.x = texture(uSampler, coordX0).r / texScale; 
    height1.x = texture(uSampler, coordX1).r / texScale;
    height0.y = texture(uSampler, coordY0).r / texScale;
    height1.y = texture(uSampler, coordY1).r / texScale;
    
    vec2 MetersOverFragment = vec2(coordX1.x - coordX0.x, coordY1.y - coordY0.y) * longLatRange * mPerDegAtEq * vec2(cos(LongLat.y), 1.0);
    vec2 HeightDiffInMeters = height1 - height0;
    vec2 slope = 2.0 * reliefScale * HeightDiffInMeters / MetersOverFragment;
    slope *= .15 * uvDeriv[0] * texResolution;
    vec3 bumpNormal = normalize(vec3(slope, 1.0));
    float intensity = min(max(dot(bumpNormal, lightDir), 0.0), 1.0) + .3;  // .3 is an "ambient"

    fragColor = vec4(intensity * color.rgb, 1.0);      
}