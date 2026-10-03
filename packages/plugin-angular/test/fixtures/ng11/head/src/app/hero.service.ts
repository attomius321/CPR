import { Injectable } from '@angular/core';
import { Hero } from './hero';

@Injectable({ providedIn: 'root' })
export class HeroService {
  private heroes: Hero[] = [
    { id: 11, name: 'Dr Nice' },
    { id: 12, name: 'Narco' },
    { id: 13, name: 'Bombasto' },
  ];

  getHeroes(limit: number): Hero[] {
    return this.heroes.slice(0, limit);
  }
}
