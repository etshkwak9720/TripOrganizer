import type { VercelRequest, VercelResponse } from '@vercel/node';

const KAKAO_API_KEY = '7a8c981b5d45696b57977aa91e0f7087';
const KAKAO_LOCAL = 'https://dapi.kakao.com/v2/local/search/keyword.json';

interface KakaoDocument {
  place_name: string;
  address_name: string;
  road_address_name?: string;
  x: string;
  y: string;
}

interface KakaoResponse {
  documents: KakaoDocument[];
}

export interface GeoCandidate {
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { query } = req.query;

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query parameter required' });
  }

  try {
    const url = `${KAKAO_LOCAL}?query=${encodeURIComponent(query)}&size=5`;
    const response = await fetch(url, {
      headers: {
        Authorization: `KakaoAK ${KAKAO_API_KEY}`,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Kakao API error: ${response.status}` });
    }

    const data = (await response.json()) as KakaoResponse;

    const candidates: GeoCandidate[] = data.documents.slice(0, 5).map((d) => ({
      name: d.place_name,
      address: d.road_address_name || d.address_name,
      lat: Number(d.y),
      lng: Number(d.x),
    }));

    return res.status(200).json(candidates);
  } catch (error) {
    console.error('Geocode error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
