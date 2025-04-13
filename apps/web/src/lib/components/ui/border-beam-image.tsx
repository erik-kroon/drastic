import { BorderBeam } from "./border-beam";
import { Card, CardContent } from "./card";

interface BorderBeamImageProps {
  imagePath?: string;
  duration?: number;
  size?: number;
  reverse?: boolean;
}

export function BorderBeamImage({
  imagePath,
  duration = 10,
  size = 125,
  reverse = false,
}: BorderBeamImageProps) {
  return (
    <Card className="relative max-w-4xl p-0 pr-0 overflow-hidden">
      <CardContent className="px-0">
        <img src={imagePath} alt="Calendar" className="w-full" />
      </CardContent>
      <BorderBeam duration={duration} size={size} reverse={reverse} />
    </Card>
  );
}
