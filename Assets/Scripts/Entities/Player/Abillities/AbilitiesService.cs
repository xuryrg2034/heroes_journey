using System.Collections.Generic;
using Cysharp.Threading.Tasks;
using UnityEngine;

namespace Entities.Player
{
    // TODO: Прикинуть как избавиться от сервиса. По сути это просто прокся для методов героя
    public class AbilitiesService
    {
        readonly Hero _owner;
        
        public AbilitiesService(Hero hero)
        {
            _owner = hero;
        }
        
        public List<BaseAbility> Abilities => _owner.Abilities;
        
        public BaseAbility SelectedAbility => _owner.SelectedAbility;
        
        public void SelectAbility(BaseAbility ability)
        {
            _owner.SelectAbility(ability);
        }

        public void DeselectAbility()
        {
            _owner.DeselectAbility();
        }

        public async UniTask Execute()
        {
            await _owner.ExecuteAbility();
        }
    }
}