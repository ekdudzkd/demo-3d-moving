// 팀이 코드로 만든 공개 샘플 (assets/samples, CC0)
import apple from "../../../../assets/samples/apple.png";
import car from "../../../../assets/samples/car.png";
import star from "../../../../assets/samples/star.png";

export const SAMPLES = [
  { id: "apple", label: "사과", url: apple },
  { id: "car", label: "자동차", url: car },
  { id: "star", label: "별", url: star },
];

export async function sampleFile(url: string, id: string): Promise<File> {
  const blob = await (await fetch(url)).blob();
  return new File([blob], `${id}.png`, { type: "image/png" });
}
