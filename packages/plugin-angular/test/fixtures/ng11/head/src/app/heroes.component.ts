import { Component, OnInit } from '@angular/core';
import { Hero } from './hero';
import { HeroService } from './hero.service';

@Component({
  selector: 'app-heroes',
  templateUrl: './heroes.component.html',
})
export class HeroesComponent implements OnInit {
  heroes: Hero[] = [];
  selectedHero?: Hero;

  constructor(private heroService: HeroService) {}

  ngOnInit(): void {
    this.heroes = this.heroService.getHeroes(10);
  }

  select(hero: Hero): void {
    this.selectedHero = hero;
  }

  add(name: string): void {
    const id = Math.max(0, ...this.heroes.map((h) => h.id)) + 1;
    this.heroes = [...this.heroes, { id, name: name.trim() }];
  }
}
