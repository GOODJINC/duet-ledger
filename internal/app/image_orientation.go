package app

import (
	"bytes"
	"encoding/binary"
	"image"
)

// Phone photos often store rotation in EXIF rather than in their pixels. Apply
// that rotation before stripping metadata, without trusting EXIF offsets.
func jpegOrientation(data []byte) int {
	if len(data) < 4 || data[0] != 0xff || data[1] != 0xd8 {
		return 1
	}
	for offset := 2; offset+4 <= len(data); {
		if data[offset] != 0xff {
			return 1
		}
		marker := data[offset+1]
		if marker == 0xff {
			offset++
			continue
		}
		offset += 2
		if marker == 0xda || marker == 0xd9 {
			return 1
		}
		if marker >= 0xd0 && marker <= 0xd8 || marker == 1 {
			continue
		}
		n := int(binary.BigEndian.Uint16(data[offset : offset+2]))
		if n < 2 || offset+n > len(data) {
			return 1
		}
		segment := data[offset+2 : offset+n]
		offset += n
		if marker != 0xe1 || !bytes.HasPrefix(segment, []byte("Exif\x00\x00")) {
			continue
		}
		tiff := segment[6:]
		if len(tiff) < 8 {
			return 1
		}
		var order binary.ByteOrder
		if string(tiff[:2]) == "II" {
			order = binary.LittleEndian
		} else if string(tiff[:2]) == "MM" {
			order = binary.BigEndian
		} else {
			return 1
		}
		if order.Uint16(tiff[2:4]) != 42 {
			return 1
		}
		start := uint64(order.Uint32(tiff[4:8]))
		if start+2 > uint64(len(tiff)) {
			return 1
		}
		count := int(order.Uint16(tiff[int(start) : int(start)+2]))
		for i := 0; i < count; i++ {
			position := int(start) + 2 + i*12
			if position+12 > len(tiff) {
				return 1
			}
			entry := tiff[position : position+12]
			if order.Uint16(entry[:2]) == 0x112 && order.Uint16(entry[2:4]) == 3 && order.Uint32(entry[4:8]) == 1 {
				value := int(order.Uint16(entry[8:10]))
				if value >= 1 && value <= 8 {
					return value
				}
				return 1
			}
		}
	}
	return 1
}
func orientImage(src *image.RGBA, orientation int) *image.RGBA {
	if orientation < 2 || orientation > 8 {
		return src
	}
	width, height := src.Bounds().Dx(), src.Bounds().Dy()
	w, h := width, height
	if orientation >= 5 {
		w, h = height, width
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			dx, dy := x, y
			switch orientation {
			case 2:
				dx = width - 1 - x
			case 3:
				dx, dy = width-1-x, height-1-y
			case 4:
				dy = height - 1 - y
			case 5:
				dx, dy = y, x
			case 6:
				dx, dy = height-1-y, x
			case 7:
				dx, dy = height-1-y, width-1-x
			case 8:
				dx, dy = y, width-1-x
			}
			dst.SetRGBA(dx, dy, src.RGBAAt(x+src.Bounds().Min.X, y+src.Bounds().Min.Y))
		}
	}
	return dst
}
