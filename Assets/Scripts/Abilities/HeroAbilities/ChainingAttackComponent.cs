using System;
using System.Collections.Generic;
using System.Linq;
using Core.Entities;
using DG.Tweening;
using Services.Grid;
using Services.Selection;
using UnityEngine;

namespace Abilities.HeroAbilities
{
    public class ChainingAttackComponent : BaseAbility
    {
        private Hero _hero;
        private Entity _lastSelectedTarget;
        private readonly List<Entity> _selectedEntities = new();
        private Sequence _executeSequence;

        public override string Title { get; } = "Chaining";

        private void Start()
        {
            _hero = GetComponent<Hero>();
            _lastSelectedTarget = _hero;
        }
        
        public override void Activate()
        {
            EntityClickHandler.OnEntityClicked += HandleClick;
        }

        public override void Deactivate()
        {
            EntityClickHandler.OnEntityClicked -= HandleClick;
            
            _resetSelection();
        }
        
        public override void HandleClick(Entity entity)
        {
            if (entity == _hero)
            {
                _resetSelection();
                return;
            }

            if (_selectedEntities.Contains(entity))
            {
                _removeEnemiesAfter(entity);
                return;
            }
             
            if (_isInRange(_lastSelectedTarget.Cell.Position, entity.Cell.Position, _hero.AttackRange))
            {
                if (!_canSelectionTypeByType(entity)) return;

                var canDestroy = DamageCalculationService.CanDestroyEntity(_hero, entity);

                if (canDestroy)
                {
                    _selectEnemy(entity);
                    DamageCalculationService.RecalculateDamage(_hero, _selectedEntities); // Обновляем урон 
                }
                else
                {
                    Debug.LogWarning("Not enough damage to destroy this enemy!");
                }
            }
            else
            {
                Debug.LogWarning("Target out of range!");
            }
        }

        public override Tween Execute()
        {
            if (_selectedEntities.Count == 0) return default;

            _executeSequence = DOTween.Sequence();
            foreach (var entity in _selectedEntities)
            {
                var heroMove = _hero.Move(entity.Cell);
                var entityTakeDamage = entity.TakeDamage(_hero.RemainingDamage);

                _executeSequence.Append(entityTakeDamage);
                _executeSequence.Append(heroMove);
            }

            _executeSequence.OnComplete(_resetSelection);

            return _executeSequence;
        }

        public override void Interrupt()
        {
            _executeSequence?.Kill();
            _resetSelection();
        }

        private bool _canSelectionTypeByType(Entity entity)
        {
            if (_lastSelectedTarget.Type == EntityType.Hero)
            {
                return true;
            }

            if (entity.Type != EntityType.Enemy) return false;
            
            return ((Enemy)entity).Color == ((Enemy)_lastSelectedTarget).Color;
        }
        
        private void _removeEnemiesAfter(Entity target)
        {
            var index = _selectedEntities.IndexOf(target);
            if (index < 0) return;

            for (var i = _selectedEntities.Count - 1; i > index; i--)
            {
                _highlightEnemy(_selectedEntities[i], false);
                _selectedEntities.RemoveAt(i);
            }

            _lastSelectedTarget = target;
            DamageCalculationService.RecalculateDamage(_hero, _selectedEntities);
        }
        
        private void _selectEnemy(Entity entity)
        {
            _lastSelectedTarget = entity;
            _selectedEntities.Add(entity);
            _highlightEnemy(entity, true);
        }
        
        private void _resetSelection()
        {
            foreach (var enemy in _selectedEntities)
            {
                _highlightEnemy(enemy, false);
            }
            _selectedEntities.Clear();
            _lastSelectedTarget = _hero;
             
            // Сброс урона героя
            DamageCalculationService.Reset(_hero);
        }
    }
}