using System;
using Core.Entities;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using UnityEngine;

namespace Abilities.HeroAbilities
{
    public abstract class BaseAbility
    {
        public string Title { get; private set; }
        
        public Entity Owner { get; private set; }

        protected BaseAbility(Hero owner, string title)
        {
            Title = title;
            Owner = owner;
        }
        
        public abstract void SelectTarget(Entity entity);

        public abstract void Activate();
        
        public abstract void Deactivate();

        public abstract UniTask Execute();

        public abstract void Cancel();
        
        protected void _highlightEnemy(Entity entity, bool highlight)
        {
            // entity.IsSelected = highlight; // Подсветка
        }
        
        protected bool _isInRange(Vector2Int origin, Vector2Int target, int range)
        {
            var dx = Mathf.Abs(origin.x - target.x);
            var dy = Mathf.Abs(origin.y - target.y);

            // Используем челночное расстояние
            return Mathf.Max(dx, dy) <= range;
        }
    }
}