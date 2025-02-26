using System;
using System.Collections.Generic;
using System.Linq;
using Core.Entities;
using Cysharp.Threading.Tasks;
using DG.Tweening;
using Services.Selection;
using UnityEngine;

namespace Abilities.Hero
{
    [Serializable]
    public class ChainingAttack : BaseAbility
    {
        private readonly List<Entity> _selectedEntities = new();
        private Sequence _executeSequence;
        private EntitySelectionType _availableSelectionType = EntitySelectionType.Neutral;
        
        public override void Activate()
        {
            EntityClickHandler.OnEntityClicked += SelectTarget;
        }

        public override void Deactivate()
        {
            EntityClickHandler.OnEntityClicked -= SelectTarget;
            
            _resetSelection();
        }
        
        public override void SelectTarget(Entity entity)
        {
            if (entity == Hero)
            {
                _resetSelection();
                return;
            }

            if (_selectedEntities.Contains(entity))
            {
                _removeEnemiesAfter(entity);
                return;
            }

            var originPosition = _selectedEntities.Count > 0 ? _selectedEntities.Last().Cell.Position : Hero.Cell.Position;
            var isInRange = _isInRange(originPosition, entity.Cell.Position, 1);
            
            if (!isInRange) return;

            var canSelection = _canSelectionTypeByType(entity);
            
            if (!canSelection) return;

            var canDestroy = DamageCalculationService.CanDestroyEntity(Hero, entity);
            
            if (canDestroy)
            {
                _availableSelectionType = entity.SelectionType;
                _selectedEntities.Add(entity);
                _highlightTarget(entity.Cell, true);
                DamageCalculationService.RecalculateDamage(Hero, _selectedEntities); // Обновляем урон 
            }
            else
            {
                Debug.LogWarning("Not enough damage to destroy this enemy!");
            }
        }

        public override async UniTask Execute()
        {
            foreach (var entity in _selectedEntities)
            {
                await entity.Health.TakeDamage(Hero.Damage.Value);
                await Hero.Move(entity.Cell);
                _highlightTarget(entity.Cell, false);
            }
        }

        public override void Cancel()
        {
            _executeSequence?.Kill();
            _resetSelection();
        }

        private bool _canSelectionTypeByType(Entity entity)
        {
            if (
                entity.SelectionType == EntitySelectionType.Neutral
                || _availableSelectionType == EntitySelectionType.Neutral
            ) return true;

            return entity.SelectionType == _availableSelectionType;
        }
        
        private void _removeEnemiesAfter(Entity target)
        {
            var index = _selectedEntities.IndexOf(target);
            if (index < 0) return;

            for (var i = _selectedEntities.Count - 1; i > index; i--)
            {
                _highlightTarget(_selectedEntities[i].Cell, false);
                _selectedEntities.RemoveAt(i);
            }
            
            _availableSelectionType = _selectedEntities.Last().SelectionType;
            DamageCalculationService.RecalculateDamage(Hero, _selectedEntities);
        }
        
        private void _resetSelection()
        {
            foreach (var entity in _selectedEntities)
            {
                _highlightTarget(entity.Cell, false);
            }

            _selectedEntities.Clear();
            _availableSelectionType = EntitySelectionType.Neutral;
             
            // Сброс урона героя
            DamageCalculationService.Reset(Hero);
        }
    }
}