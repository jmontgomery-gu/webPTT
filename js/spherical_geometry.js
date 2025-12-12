
/** @type {number} Earth's radius (at the Equator) of 6378137 meters. */
// const EARTH_RADIUS = 6378137;
const EARTH_RADIUS = 1737400;   // Moon's radius

/**
 * Convert from radians to degrees
 * @param {number} radians
 */
function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}

/**
 * Convert from degrees to radians
 * @param {number} angleDegrees
 */
function toRadians(angleDegrees) {
  return (angleDegrees * Math.PI) / 180.0;
}

/**
 * Check if two floats are almost equal.
 * @param {number} a
 * @param {number} b
 */
function floatEqual(a, b) {
    if (a === b) {
      return true;
    }
  
    const diff = Math.abs(a - b);
  
    return diff < Number.EPSILON;
}

/**
 * Comparison function
 * @param {LatLng} one
 * @param {LatLng} two
 * @returns {boolean}
 */
function equals(one, two) {
    one = convert(one);
    two = convert(two);
    return floatEqual(one[LAT], two[LAT]) && floatEqual(one[LNG], two[LNG]);
}

const LAT = 'latitude';
const LNG = 'longitude';

class LatLng {
  /**
   * @param {number} lat
   * @param {number} lng
   * @param {boolean} noWrap
   */
  constructor(lat, lng, noWrap = false) {
    lat = parseFloat(lat);
    lng = parseFloat(lng);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      throw TypeError('lat or lng are not numbers');
    }

    if (!noWrap) {
      //Constrain lat to -90, 90
      lat = Math.min(Math.max(lat, -90), 90);
      //Wrap lng using modulo
      lng = lng == 180 ? lng : ((((lng + 180) % 360) + 360) % 360) - 180;
    }

    Object.defineProperty(this, LAT, { value: lat });
    Object.defineProperty(this, LNG, { value: lng });
    this.length = 2;

    Object.freeze(this);
  }

  /**
   * Comparison function
   * @param {LatLng} other
   * @returns {boolean}
   */
  equals(other) {
    return equals(this, other);
  }

  /**
   * Returns the latitude in degrees.
   * (I'd rather use getters but this is for consistency)
   * @returns {number}
   */
  lat() {
    return this[LAT];
  }

  /**
   * Returns the longitude in degrees.
   * (I'd rather use getters but this is for consistency)
   * @returns {number}
   */
  lng() {
    return this[LNG];
  }

  /** @type {number} alias for lng */
  get x() {
    return this[LNG];
  }
  /** @type {number} alias for lat */
  get y() {
    return this[LAT];
  }
  /** @type {number} alias for lng */
  get 0() {
    return this[LNG];
  }
  /** @type {number} alias for lat */
  get 1() {
    return this[LAT];
  }
  /** @type {number} alias for lng */
  get long() {
    return this[LNG];
  }
  /** @type {number} alias for lng */
  get lon() {
    return this[LNG];
  }

  /**
   * Converts to JSON representation. This function is intended to be used via
   * JSON.stringify.
   * @returns {LatLngLiteral}
   */
  toJSON() {
    return { lat: this[LAT], lng: this[LNG] };
  }

  /**
   * Converts to string representation.
   * @returns {string}
   */
  toString() {
    return `(${this[LAT]}, ${this[LNG]})`;
  }

  /**
   * Returns a string of the form "lat,lng" for this LatLng. We round the
   * lat/lng values to 6 decimal places by default.
   * @param {number} [precision=6]
   * @returns {string}
   */
  toUrlValue(precision = 6) {
    precision = parseInt(precision);
    return (
      parseFloat(this[LAT].toFixed(precision)) +
      ',' +
      parseFloat(this[LNG].toFixed(precision))
    );
  }

  [Symbol.iterator]() {
    /** @type {0 | 1} */
    let i = 0;
    return {
      next: () => {
        if (i < this.length) {
          return { value: this[i++], done: false };
        } else {
          return { done: true };
        }
      },
      [Symbol.iterator]() {
        return this;
      },
    };
  }
}

/**
 * Converts an object into a LatLng. Tries a few different methods:
 * 1. If instanceof LatLng, clone and return the object
 * 2. If it has 'lat' and 'lng' properties...
 *    2a. if the properties are functions (like Google LatLngs),
 *        use the lat() and lng() values as lat and lng
 *    2b. otherwise get lat and lng, parse them as floats and try them
 * 3. If it has 'lat' and *'long'* properties,
 *    parse them as floats and return a LatLng
 * 4. If it has 'lat' and *'lon'* properties,
 *    parse them as floats and return a LatLng
 * 5. If it has 'latitude' and 'longitude' properties,
 *    parse them as floats and return a LatLng
 * 6. If it has number values for 0 and 1, use 1 as latitude and 0
 *    as longitude.
 * 7. If it has x and y properties, try using y as latitude and x and
 *    longitude.
 * @param {LatLngLike} like
 * @returns {LatLng}
 */
function convert(like) {
    if (like instanceof LatLng) {
      return new LatLng(like[LAT], like[LNG]);
    } else if ('lat' in like && 'lng' in like) {
      if (typeof like.lat == 'function' && typeof like.lng == 'function') {
        return new LatLng(like.lat(), like.lng());
      } else {
        return new LatLng(parseFloat(like.lat), parseFloat(like.lng));
      }
    } else if ('lat' in like && 'long' in like) {
      return new LatLng(parseFloat(like.lat), parseFloat(like.long));
    } else if ('lat' in like && 'lon' in like) {
      return new LatLng(parseFloat(like.lat), parseFloat(like.lon));
    } else if ('latitude' in like && 'longitude' in like) {
      return new LatLng(parseFloat(like.latitude), parseFloat(like.longitude));
    } else if (typeof like[0] === 'number' && typeof like[1] === 'number') {
      return new LatLng(like[1], like[0]);
    } else if ('x' in like && 'y' in like) {
      return new LatLng(parseFloat(like.y), parseFloat(like.x));
    } else {
      throw new TypeError(`Cannot convert ${like} to LatLng`);
    }
  }

/**
 * @param {LatLng} from
 * @param {LatLng} to
 * @returns {number}
 */
function computeDistanceBetweenHelper(from, to) {
    const radFromLat = toRadians(from.lat());
    const radFromLng = toRadians(from.lng());
    const radToLat = toRadians(to.lat());
    const radToLng = toRadians(to.lng());
    return (
        2 *
        Math.asin(
        Math.sqrt(
            Math.pow(Math.sin((radFromLat - radToLat) / 2), 2) +
            Math.cos(radFromLat) *
                Math.cos(radToLat) *
                Math.pow(Math.sin((radFromLng - radToLng) / 2), 2)
        )
        )
    );
}
  
/**
 * Returns the distance, in meters, between to LatLngs. You can optionally
 * specify a custom radius. The radius defaults to the radius of the Earth.
 * @param {LatLng} from
 * @param {LatLng} to
 * @param {number} [radius]
 * @returns {number} distance
 */
function computeDistanceBetween(
    from,
    to,
    radius = EARTH_RADIUS
  ) {
    from = convert(from);
    to = convert(to);
    return computeDistanceBetweenHelper(from, to) * radius;
}  

/**
 * @param {LatLng} a
 * @param {LatLng} b
 * @param {LatLng} c
 * @returns number
 */
function sphericalExcess(a, b, c) {
    const polygon = [a, b, c, a];
    const distances = [];
    let sumOfDistances = 0;
    for (let i = 0; i < 3; i++) {
      distances[i] = computeDistanceBetweenHelper(polygon[i], polygon[i + 1]);
      sumOfDistances += distances[i];
    }
  
    const semiPerimeter = sumOfDistances / 2;
    let tan = Math.tan(semiPerimeter / 2);
    for (let i = 0; i < 3; i++) {
      tan *= Math.tan((semiPerimeter - distances[i]) / 2);
    }
    return 4 * Math.atan(Math.sqrt(Math.abs(tan)));
  }
  
  /**
   * @param {LatLng} a
   * @param {LatLng} b
   * @param {LatLng} c
   * @returns number
   */
  function sphericalSign(a, b, c) {
    const matrix = [a, b, c].map((point) => {
      const lat = toRadians(point.lat());
      const lng = toRadians(point.lng());
      return [
        Math.cos(lat) * Math.cos(lng),
        Math.cos(lat) * Math.sin(lng),
        Math.sin(lat),
      ];
    });
  
    return 0 <
      matrix[0][0] * matrix[1][1] * matrix[2][2] +
        matrix[1][0] * matrix[2][1] * matrix[0][2] +
        matrix[2][0] * matrix[0][1] * matrix[1][2] -
        matrix[0][0] * matrix[2][1] * matrix[1][2] -
        matrix[1][0] * matrix[0][1] * matrix[2][2] -
        matrix[2][0] * matrix[1][1] * matrix[0][2]
      ? 1
      : -1;
  }
  
  /**
   * @param {LatLng} a
   * @param {LatLng} b
   * @param {LatLng} c
   * @returns number
   */
  function computeSphericalExcess(a, b, c) {
    return sphericalExcess(a, b, c) * sphericalSign(a, b, c);
  }

/**
 * Returns the signed area of a closed path. The signed area may be used to
 * determine the orientation of the path. The computed area uses the same units
 * as the radius. The radius defaults to the Earth's radius in meters, in which
 * case the area is in square meters.
 * @param {LatLngLike[]} loop
 * @param {number} [radius]
 * @returns {number}
 */
function computeSignedArea(loop, radius = EARTH_RADIUS) {
    if (loop.length < 3) return 0;
    loop = loop.map((v) => convert(v));
  
    let total = 0;
    for (var i = 1; i < loop.length - 1; i++) {
      total += computeSphericalExcess(loop[0], loop[i], loop[i + 1]);
    }
    return total * radius * radius;}

/**
 * Returns the area of a closed path. The computed area uses the same units as
 * the radius. The radius defaults to the Earth's radius in meters, in which
 * case the area is in square meters.
 * @param {LatLngLike[]} path
 * @param {number} [radius]
 * @returns {number} area
 */
function computeArea(path, radius = EARTH_RADIUS) {
    return Math.abs(computeSignedArea(path, radius));
}
  