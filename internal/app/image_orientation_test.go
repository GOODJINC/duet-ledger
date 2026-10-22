package app

import (
	"encoding/binary"
	"image"
	"image/color"
	"testing"
)

func TestPhoneImageOrientation(t *testing.T) {
	// A minimal JPEG APP1 segment with a little-endian EXIF orientation entry.
	exif := []byte{'E', 'x', 'i', 'f', 0, 0, 'I', 'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 1, 3, 0, 1, 0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0}
	jpeg := []byte{0xff, 0xd8, 0xff, 0xe1, 0, 0}
	binary.BigEndian.PutUint16(jpeg[4:6], uint16(len(exif)+2))
	jpeg = append(jpeg, exif...)
	jpeg = append(jpeg, 0xff, 0xd9)
	if jpegOrientation(jpeg) != 6 {
		t.Fatal("EXIF orientation not detected")
	}
	for i := range jpeg {
		_ = jpegOrientation(jpeg[:i])
	}
	original := image.NewRGBA(image.Rect(0, 0, 2, 3))
	red := color.RGBA{R: 255, A: 255}
	original.SetRGBA(0, 0, red)
	rotated := orientImage(original, 6)
	if rotated.Bounds().Dx() != 3 || rotated.Bounds().Dy() != 2 || rotated.RGBAAt(2, 0) != red {
		t.Fatal("clockwise phone rotation incorrect")
	}
	for n := 1; n <= 8; n++ {
		result := orientImage(original, n)
		if result.Bounds().Dx()*result.Bounds().Dy() != 6 {
			t.Fatal("rotation lost pixels")
		}
	}
}
